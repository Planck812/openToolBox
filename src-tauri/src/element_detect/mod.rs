//! 窗口/控件自动识别模块。
//!
//! 截图覆盖层上鼠标悬停时，识别鼠标下的控件块（UIA `ElementFromPoint` + 向上寻祖）
//! 或顶层窗口（Win32 兜底），返回其屏幕矩形，供前端高亮/点击吸附。
//!
//! 关键点（研究确认）：
//! - UIA 全部用**物理像素**桌面坐标；入参 `PhysicalDesktopPointI32` 已是物理点。
//! - `ElementFromPoint` 是跨进程 RPC，可能慢 → 必须 `spawn_blocking` + 前端节流。
//! - 必须排除覆盖层自身窗口（透明 WebView 仍会被命中）。
//! - UIPI 受限/自绘控件 → 降级到窗口级（`WindowFromPoint + GetAncestor + GetWindowRect`）。

use serde::Serialize;
use specta::Type;
#[cfg(windows)]
use tauri::Manager;
#[cfg(windows)]
use tauri::async_runtime::spawn_blocking;

use crate::error::AppError;
use crate::screenshot_shared::types::PhysicalDesktopPointI32;

/// 向上寻祖的最大步数（防止死循环）。
#[cfg(windows)]
const MAX_WALK_STEPS: u32 = 16;
/// 控件级高亮的最小矩形（物理像素）：小于此且类型不匹配时继续向上。
#[cfg(windows)]
const MIN_HIGHLIGHT_W: i32 = 64;
#[cfg(windows)]
const MIN_HIGHLIGHT_H: i32 = 32;

/// RAII：`spawn_blocking` 线程若新初始化了 COM（`CoInitializeEx` 返回 S_OK），
/// 退出时配对 `CoUninitialize`，避免 COM 初始化泄漏。
#[cfg(windows)]
struct ComUninitGuard(bool);

#[cfg(windows)]
impl Drop for ComUninitGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

/// 识别出的元素（物理屏幕像素矩形 + 元数据）。
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DetectedElement {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub control_type: i32,
    pub name: String,
    /// true = 顶层窗口（控件级识别失败时的降级结果）。
    pub is_window: bool,
    /// 包含该元素的顶层窗口矩形（物理像素）。窗口级识别时为 None（自身即窗口）。
    /// 前端用它做「控件所在窗口去阴影」。
    pub window_rect: Option<[i32; 4]>,
}

/// 收集覆盖层窗口（label 前缀 `overlay-`）的 HWND 集合，用于排除自身。
#[cfg(windows)]
fn overlay_handles(app: &tauri::AppHandle) -> Vec<windows::Win32::Foundation::HWND> {
    let mut out = Vec::new();
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay-") {
            if let Ok(hwnd) = win.hwnd() {
                out.push(hwnd);
            }
        }
    }
    out
}

/// 判断 HWND 是否属于覆盖层自身。
#[cfg(windows)]
fn is_overlay_handle(hwnd: windows::Win32::Foundation::HWND, overlays: &[windows::Win32::Foundation::HWND]) -> bool {
    overlays.contains(&hwnd)
}

/// 判断 UIA 元素是否就是桌面根元素（命中空白桌面 → 未命中，不高亮）。
#[cfg(windows)]
fn is_root(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    el: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    root: Option<&windows::Win32::UI::Accessibility::IUIAutomationElement>,
) -> bool {
    if let Some(r) = root {
        if unsafe { automation.CompareElements(el, r) }
            .unwrap_or_default()
            .as_bool()
        {
            return true;
        }
    }
    false
}

/// 排除覆盖层自身（按原生 HWND 比较）或桌面根元素。
#[cfg(windows)]
fn is_overlay_or_root(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    el: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    overlays: &[windows::Win32::Foundation::HWND],
    root: Option<&windows::Win32::UI::Accessibility::IUIAutomationElement>,
) -> bool {
    if let Ok(hwnd) = unsafe { el.CurrentNativeWindowHandle() } {
        let null_hwnd = windows::Win32::Foundation::HWND(std::ptr::null_mut());
        if hwnd != null_hwnd && is_overlay_handle(hwnd, overlays) {
            return true;
        }
    }
    is_root(automation, el, root)
}

/// 从起始元素沿 ControlViewWalker **向上**寻祖，返回第一个「值得高亮」的元素。
/// 若命中覆盖层自身/桌面根、或超过最大步数 → None。
#[cfg(windows)]
fn walk_up_to_highlightable(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    walker: &windows::Win32::UI::Accessibility::IUIAutomationTreeWalker,
    start: windows::Win32::UI::Accessibility::IUIAutomationElement,
    overlay_handles: &[windows::Win32::Foundation::HWND],
    root: Option<&windows::Win32::UI::Accessibility::IUIAutomationElement>,
    window_rect: Option<[i32; 4]>,
) -> Result<Option<DetectedElement>, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::Accessibility::{
        UIA_ButtonControlTypeId, UIA_ComboBoxControlTypeId, UIA_DocumentControlTypeId,
        UIA_EditControlTypeId, UIA_GroupControlTypeId, UIA_ListControlTypeId,
        UIA_ListItemControlTypeId, UIA_MenuItemControlTypeId, UIA_PaneControlTypeId,
        UIA_TabItemControlTypeId, UIA_TreeItemControlTypeId, UIA_WindowControlTypeId,
    };

    let mut el = start;
    for _ in 0..MAX_WALK_STEPS {
        let rect: RECT = unsafe { el.CurrentBoundingRectangle() }
            .unwrap_or(RECT { left: 0, top: 0, right: 0, bottom: 0 });
        let offscreen = unsafe { el.CurrentIsOffscreen() }.unwrap_or_default().as_bool();
        let ctype = unsafe { el.CurrentControlType() }.unwrap_or_default();
        let name = unsafe { el.CurrentName() }.unwrap_or_default().to_string();

        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;

        // 排除覆盖层自身 / 桌面根（向上寻祖过程中也可能命中）。
        if is_overlay_or_root(automation, &el, overlay_handles, root) {
            return Ok(None);
        }

        // 值得高亮：类型匹配 或 矩形足够大。
        let type_ok = ctype.0 == UIA_ButtonControlTypeId.0
            || ctype.0 == UIA_ListItemControlTypeId.0
            || ctype.0 == UIA_GroupControlTypeId.0
            || ctype.0 == UIA_PaneControlTypeId.0
            || ctype.0 == UIA_WindowControlTypeId.0
            || ctype.0 == UIA_DocumentControlTypeId.0
            || ctype.0 == UIA_EditControlTypeId.0
            || ctype.0 == UIA_ListControlTypeId.0
            || ctype.0 == UIA_ComboBoxControlTypeId.0
            || ctype.0 == UIA_TreeItemControlTypeId.0
            || ctype.0 == UIA_TabItemControlTypeId.0
            || ctype.0 == UIA_MenuItemControlTypeId.0;
        if !offscreen && w > 0 && h > 0 && (type_ok || (w >= MIN_HIGHLIGHT_W && h >= MIN_HIGHLIGHT_H)) {
            return Ok(Some(DetectedElement {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                control_type: ctype.0,
                name,
                is_window: ctype.0 == UIA_WindowControlTypeId.0,
                window_rect,
            }));
        }

        // 向上取父（GetParentElement 返回 Err 即无父元素，结束）。
        match unsafe { walker.GetParentElement(&el) } {
            Ok(parent) => el = parent,
            Err(_) => return Ok(None),
        }
    }
    Ok(None)
}

/// 判断 HWND 是否属于桌面外壳窗口（桌面窗口 / Progman / WorkerW 壁纸层）。
/// 悬停在空白桌面时应「未命中」，不高亮整个桌面。
#[cfg(windows)]
fn is_desktop_shell(hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetDesktopWindow};

    if hwnd == unsafe { GetDesktopWindow() } {
        return true;
    }
    let mut buf = [0u16; 32];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return false;
    }
    let class = String::from_utf16_lossy(&buf[..len as usize]);
    class == "Progman" || class == "WorkerW"
}

/// EnumWindows 回调上下文：收集「鼠标点下第一个命中」的顶层窗口（句柄 + 矩形）。
#[cfg(windows)]
struct WindowDetectCtx {
    point: windows::Win32::Foundation::POINT,
    overlays: Vec<windows::Win32::Foundation::HWND>,
    found: Option<(
        windows::Win32::Foundation::HWND,
        windows::Win32::Foundation::RECT,
    )>,
}

/// EnumWindows 回调：按 Z 序（从上到下）找第一个可见、非覆盖层、非桌面外壳、
/// 且矩形包含鼠标点的顶层窗口（找到即停止）。
#[cfg(windows)]
unsafe extern "system" fn window_detect_enum(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible};

    let ctx = unsafe { &mut *(lparam.0 as *mut WindowDetectCtx) };
    // 跳过覆盖层自身与桌面外壳（覆盖层是置顶全屏窗口，会挡住真实窗口的命中）。
    if is_overlay_handle(hwnd, &ctx.overlays) || is_desktop_shell(hwnd) {
        return true.into();
    }
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return true.into();
    }
    let mut rect: RECT = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return true.into();
    }
    if ctx.point.x >= rect.left
        && ctx.point.x < rect.right
        && ctx.point.y >= rect.top
        && ctx.point.y < rect.bottom
    {
        ctx.found = Some((hwnd, rect));
        return false.into(); // 找到即停止枚举。
    }
    true.into()
}

/// 用 EnumWindows 按 Z 序（从上到下）找「跳过覆盖层/桌面外壳后、可见且包含
/// 鼠标点」的第一个真实顶层窗口，返回其 HWND + 矩形。
///
/// 注意：截图覆盖层是置顶全屏窗口，`WindowFromPoint` 会命中覆盖层自身，
/// 因此不能直接用 `WindowFromPoint`，必须枚举跳过覆盖层。
#[cfg(windows)]
fn find_window_below(
    pt: PhysicalDesktopPointI32,
    overlay_handles: &[windows::Win32::Foundation::HWND],
) -> Option<(windows::Win32::Foundation::HWND, windows::Win32::Foundation::RECT)> {
    use windows::Win32::Foundation::{LPARAM, POINT};
    use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

    let mut ctx = WindowDetectCtx {
        point: POINT { x: pt.x, y: pt.y },
        overlays: overlay_handles.to_vec(),
        found: None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(window_detect_enum),
            LPARAM(&mut ctx as *mut WindowDetectCtx as isize),
        );
    }
    ctx.found
}

/// Win32 窗口级识别（UIA 失败/受限时的兜底）：命中点 → 顶层窗口矩形。
#[cfg(windows)]
fn window_detect(
    pt: PhysicalDesktopPointI32,
    overlay_handles: &[windows::Win32::Foundation::HWND],
) -> Option<DetectedElement> {
    let (_hwnd, rect) = find_window_below(pt, overlay_handles)?;
    Some(DetectedElement {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        control_type: 0,
        name: String::new(),
        is_window: true,
        window_rect: None, // 自身即窗口。
    })
}

/// UIA 子树点命中：从窗口的 UIA 根元素沿 ControlViewWalker 向下递归，
/// 找「包含鼠标点」的**最深**控件（叶子优先）。返回最深的命中元素。
///
/// 这是覆盖层存在时的控件级识别方案：`ElementFromPoint` 会命中覆盖层自身，
/// 所以改用「先找到覆盖层下方的窗口 → ElementFromHandle(窗口) → 子树点命中」。
#[cfg(windows)]
fn uia_subtree_hit(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    hwnd: windows::Win32::Foundation::HWND,
    pt: PhysicalDesktopPointI32,
) -> windows::core::Result<Option<windows::Win32::UI::Accessibility::IUIAutomationElement>> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Accessibility::IUIAutomationElement;

    let root = unsafe { automation.ElementFromHandle(hwnd) }?;
    let walker = unsafe { automation.ControlViewWalker() }?;
    let point = POINT { x: pt.x, y: pt.y };

    // 递归找包含鼠标点的最深元素：返回 (深度, 元素)，深度越大越深。
    // 遍历所有子元素（不 break），取深度最大的命中，避免「树序第一个命中
    // 但不是最深」的误判（用户从外层直接移回内层时中间层会误命中）。
    // 子树遍历深度上限：UIA 树深度不可控（长文档/树形控件），
    // 无界递归会栈溢出并直接 abort 进程。
    const MAX_DEPTH: u32 = 64;

    fn find_deepest(
        walker: &windows::Win32::UI::Accessibility::IUIAutomationTreeWalker,
        el: &IUIAutomationElement,
        point: POINT,
        depth: u32,
    ) -> windows::core::Result<(u32, IUIAutomationElement)> {
        // 自身不包含点 → 该子树无命中。
        let self_rect = unsafe { el.CurrentBoundingRectangle() }
            .unwrap_or(windows::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            });
        let self_hit = point.x >= self_rect.left
            && point.x < self_rect.right
            && point.y >= self_rect.top
            && point.y < self_rect.bottom;

        if !self_hit {
            return Ok((0, el.clone())); // 标记「未命中」（深度 0 且自身不含点）。
        }

        // 自身命中：找所有子元素中更深的那一层（到达深度上限则不再下探）。
        let mut deepest: Option<(u32, IUIAutomationElement)> = None;
        if depth < MAX_DEPTH {
            let mut child = unsafe { walker.GetFirstChildElement(el) }.ok();
            while let Some(c) = child {
                if let Ok((child_depth, hit)) = find_deepest(walker, &c, point, depth + 1) {
                    // child_depth > 0 表示子元素子树有命中（含点）。
                    if child_depth > 0 && deepest.as_ref().is_none_or(|(d, _)| child_depth > *d) {
                        deepest = Some((child_depth, hit));
                    }
                }
                child = unsafe { walker.GetNextSiblingElement(&c) }.ok();
            }
        }
        // 返回自身（深度 1）或更深的子命中。
        Ok(deepest.unwrap_or((1, el.clone())))
    }

    let (_, hit) = find_deepest(&walker, &root, point, 0)?;
    // depth == 0 且自身不含点 → 未命中。
    let self_rect = unsafe { hit.CurrentBoundingRectangle() }.unwrap_or_default();
    if point.x >= self_rect.left
        && point.x < self_rect.right
        && point.y >= self_rect.top
        && point.y < self_rect.bottom
    {
        Ok(Some(hit))
    } else {
        Ok(None)
    }
}

/// 识别鼠标点下的元素（控件级优先，窗口级兜底）。
#[tauri::command]
#[specta::specta]
#[cfg(windows)]
pub async fn element_from_point(
    app: tauri::AppHandle,
    point: PhysicalDesktopPointI32,
) -> Result<Option<DetectedElement>, AppError> {
    // 在阻塞线程内完成 UIA（跨进程 RPC 可能慢），避免占主线程。
    let app_clone = app.clone();
    spawn_blocking(move || {
        use windows::Win32::System::Com::{
            CoCreateInstance, CLSCTX_ALL, CoInitializeEx, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};

        let overlays = overlay_handles(&app_clone);

        // 截图覆盖层是置顶全屏窗口：`WindowFromPoint`/`ElementFromPoint` 都命中覆盖层自身。
        // 因此：先枚举找到覆盖层**下方**的真实窗口，再对其 UIA 子树做点命中。
        let Some((win_below, win_rect)) = find_window_below(point, &overlays) else {
            return Ok(None);
        };

        // COM 初始化（幂等，重复调用返回 S_FALSE）。S_OK 表示本线程新初始化，
        // 需在退出时配对 CoUninitialize；S_FALSE 表示已被外层初始化，不重复反初始化。
        let init_hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if init_hr.0 < 0 {
            log::error!(
                "[element_detect] COM 初始化失败（0x{:08X}），降级窗口级识别",
                init_hr.0 as u32
            );
            return Ok(window_detect(point, &overlays));
        }
        let _com_guard = ComUninitGuard(init_hr.0 == 0);
        let automation: IUIAutomation =
            match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) } {
                Ok(a) => a,
                Err(e) => {
                    log::error!("[element_detect] 创建 IUIAutomation 失败：{e}");
                    return Ok(window_detect(point, &overlays));
                }
            };

        // 控件级：UIA 子树点命中 → 向上寻祖到值得高亮的祖先。
        // window_rect：包含该控件的顶层窗口矩形（前端用于「控件所在窗口去阴影」）。
        let win_rect_arr = Some([win_rect.left, win_rect.top, win_rect.right, win_rect.bottom]);
        match uia_subtree_hit(&automation, win_below, point) {
            Ok(Some(hit)) => {
                if let Ok(walker) = unsafe { automation.ControlViewWalker() } {
                    if let Ok(Some(el)) = walk_up_to_highlightable(
                        &automation, &walker, hit, &overlays, None, win_rect_arr,
                    ) {
                        return Ok(Some(el));
                    }
                }
                // 寻祖未命中 → 窗口级。
                Ok(window_detect(point, &overlays))
            }
            // UIA 子树失败/未命中 → 窗口级兜底。
            _ => Ok(window_detect(point, &overlays)),
        }
    })
    .await
    .map_err(|e| format!("元素检测线程失败：{e}"))?
    .map_err(AppError::Message)
}

/// 非 Windows 平台：无 UIA，直接返回 None（截图功能本就 Windows 优先）。
#[tauri::command]
#[specta::specta]
#[cfg(not(windows))]
pub async fn element_from_point(
    _app: tauri::AppHandle,
    _point: PhysicalDesktopPointI32,
) -> Result<Option<DetectedElement>, AppError> {
    Ok(None)
}
