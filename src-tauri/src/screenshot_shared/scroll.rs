//! 滚动截图（长截图）的滚动控制器：目标窗口解析 + 滚动注入。
//!
//! 平台：仅 Windows（cfg(windows)）。macOS/Linux 的平台滚动事件在
//! `screenshot_shared::scroll_platform`（子任务 E）实现。
//!
//! 当前交互是**手动滚动**（用户自己滚，工具只采集拼接），因此下述
//! 滚动注入能力（SendInput/UIA/WM_MOUSEWHEEL）暂未使用；保留供
//! 子任务 E（非 Windows 平台）或未来「自动滚动」模式复用。
//! 以 `#[allow(dead_code)]` 标注，避免编译告警。

use crate::screenshot_shared::types::PhysicalDesktopPointI32;

/// 可跨线程传递的 HWND 包装（原生句柄非 Send，显式声明安全）。
/// 前提：所有访问经 `scroll.rs` 的 Mutex 序列化，且只用于向目标发送
/// 异步/带超时的窗口消息，不阻塞等待跨进程窗口处理。
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SendHwnd(pub windows::Win32::Foundation::HWND);

// SAFETY: HWND 仅作为不透明句柄传递；对同一 HWND 的访问由调用方 Mutex 串行化。
#[allow(dead_code)]
unsafe impl Send for SendHwnd {}
#[allow(dead_code)]
unsafe impl Sync for SendHwnd {}

/// 滚动注入方法。
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScrollMethod {
    /// UIA ScrollPattern（精确 + 判底），首选。
    UiAutomation,
    /// SendInput 滚轮注入，与真实滚轮等效。
    SendInput,
    /// WM_MOUSEWHEEL 消息回退。
    WheelMessage,
}

/// 按屏幕坐标解析目标窗口：`WindowFromPoint` + `GetAncestor(GA_ROOT)`。
///
/// `pt` 是物理像素虚拟桌面坐标（滚动截图选区中心）；单屏场景即屏幕坐标。
/// 多屏时由调用方把虚拟桌面坐标映射到主坐标（子任务 B 处理）。
#[allow(dead_code)]
pub fn resolve_target_window(pt: PhysicalDesktopPointI32) -> Option<SendHwnd> {
    use windows::Win32::Foundation::{POINT};
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};

    let point = POINT { x: pt.x, y: pt.y };
    unsafe {
        let hwnd = WindowFromPoint(point);
        if hwnd.0.is_null() {
            return None;
        }
        let root = GetAncestor(hwnd, GA_ROOT);
        if root.0.is_null() {
            None
        } else {
            Some(SendHwnd(root))
        }
    }
}

/// 执行一次滚动注入。
///
/// `wheel_delta` 为滚轮增量（`WHEEL_DELTA=120` 一格；负值向上滚动）。
/// `client_center` 是目标窗口客户区中心屏幕坐标（SendInput 需要把光标
/// 移到目标上，滚动事件才会投递到目标窗口）。
#[allow(dead_code)]
pub fn scroll_once(
    method: ScrollMethod,
    hwnd: SendHwnd,
    client_center: PhysicalDesktopPointI32,
    wheel_delta: i32,
) -> Result<(), String> {
    match method {
        ScrollMethod::UiAutomation => uia_scroll(hwnd, wheel_delta),
        ScrollMethod::SendInput => sendinput_wheel(client_center, wheel_delta),
        ScrollMethod::WheelMessage => wheel_message(hwnd, client_center, wheel_delta),
    }
}

/// SendInput 滚轮注入：保存光标 → 移到目标客户区中心 → 发滚轮 → 恢复光标。
fn sendinput_wheel(
    client_center: PhysicalDesktopPointI32,
    wheel_delta: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, MOUSEEVENTF_WHEEL, MOUSEINPUT, INPUT, INPUT_0, INPUT_MOUSE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

    // 保存原始光标位置。
    let mut original = POINT::default();
    unsafe {
        GetCursorPos(&mut original).map_err(|e| format!("获取光标位置失败：{e}"))?;
    }

    // 移到目标客户区中心（滚动事件投递到该位置下方的窗口）。
    unsafe {
        SetCursorPos(client_center.x, client_center.y).map_err(|e| format!("移动光标失败：{e}"))?;
    }

    // 发送滚轮事件。
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                // 滚轮增量必须放在高 16 位（WHEEL_DELTA=120 一格；负值向上滚动）。
                // 直接 `wheel_delta as u32` 会把负值回绕成巨大正数且落在低位，方向/增量均错误。
                mouseData: (wheel_delta as u32) << 16,
                dwFlags: MOUSEEVENTF_WHEEL,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
    // 无论成功与否，恢复光标。
    unsafe {
        let _ = SetCursorPos(original.x, original.y);
    }
    if sent == 0 {
        return Err("SendInput 发送滚轮事件失败".to_string());
    }
    Ok(())
}

/// WM_MOUSEWHEEL 消息回退（带超时，避免目标挂起时永久阻塞）。
fn wheel_message(
    hwnd: SendHwnd,
    client_center: PhysicalDesktopPointI32,
    wheel_delta: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_MOUSEWHEEL, WHEEL_DELTA,
    };

    let wheel_delta = wheel_delta.min(WHEEL_DELTA as i32).max(-(WHEEL_DELTA as i32));
    let wparam = WPARAM((wheel_delta as usize) << 16);
    // lParam 低 16 位 = x，高 16 位 = y（屏幕坐标）。
    let lparam = LPARAM(
        ((client_center.y & 0xffff) << 16 | (client_center.x & 0xffff)) as isize,
    );

    let mut result = 0usize;
    let lres = unsafe {
        SendMessageTimeoutW(
            hwnd.0,
            WM_MOUSEWHEEL,
            wparam,
            lparam,
            SMTO_ABORTIFHUNG,
            50,
            Some(&mut result),
        )
    };
    if lres.0 == 0 {
        return Err("SendMessageTimeoutW(WM_MOUSEWHEEL) 失败".to_string());
    }
    Ok(())
}

/// UIA ScrollPattern 滚动（精确滚动 + 可判底）。
///
/// 惰性创建 IUIAutomation（CoCreateInstance），检查目标窗口根元素是否支持
/// ScrollPattern 且可垂直滚动，用 `Scroll`（增量）滚动。根元素不支持时
/// 返回错误（调用方回退 SendInput）。
///
/// 注意：仅检查根元素（不深入元素树遍历）。对滚动容器位于子树的窗口
/// （如部分 Electron 应用），首版由 SendInput 兜底；深层 UIA 遍历作为
/// 后续增强。
fn uia_scroll(hwnd: SendHwnd, wheel_delta: i32) -> Result<(), String> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CLSCTX_ALL, CoInitializeEx, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationScrollPattern,
        ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, UIA_ScrollPatternId,
    };

    // COM 初始化（幂等，重复调用返回 S_FALSE）。
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };

    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) }
            .map_err(|e| format!("创建 IUIAutomation 失败：{e}"))?;

    let element = unsafe {
        automation
            .ElementFromHandle(hwnd.0)
            .map_err(|e| format!("UIA 获取元素失败：{e}"))?
    };

    // 检查根元素是否支持 ScrollPattern。
    let pattern = unsafe {
        element
            .GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)
            .map_err(|_| "目标窗口不支持 UIA ScrollPattern".to_string())?
    };
    if !unsafe { pattern.CurrentVerticallyScrollable() }
        .unwrap_or_default()
        .as_bool()
    {
        return Err("目标窗口 UIA ScrollPattern 不可垂直滚动".to_string());
    }

    // 增量滚动保持相对方向；wheel_delta > 0 表示向下滚动（内容上移）。
    let amount = if wheel_delta > 0 {
        ScrollAmount_LargeIncrement
    } else {
        ScrollAmount_NoAmount
    };
    // Scroll 需要 horizontal/vertical 两个增量；水平不动。
    unsafe {
        pattern
            .Scroll(ScrollAmount_NoAmount, amount)
            .map_err(|e| format!("UIA Scroll 失败：{e}"))?;
    }

    Ok(())
}

/// 计算 `next` 相对 `prev` 的重叠裁剪量（`crop_top`）。
///
/// 场景：窗口内容向下滚动（用户滚动页面），`prev` 与 `next` 是滚动前后的
/// 两帧，尺寸相同（同一选区）。内容上移 `S` 像素：`next[y] == prev[y+S]`，
/// 重叠区为两帧顶部 `H-S` 行。拼接时应裁掉 `next` 顶部的重叠行数 =
/// `prev.height - S`（即 `crop_top`）。
///
/// 算法（行灰度投影 + 归一化互相关）：
/// - 每帧（中间列带）每行算灰度均值 → 一维向量 `profile[y]`。
/// - 对候选滚动量 `S ∈ [0, min(半屏, 最大滚动量)]`，比较
///   `next.profile[0..]` 与 `prev.profile[S..]` 的归一化互相关（NCC）。
/// - 网页平滑滚动时像素非精确相等，但行投影均值近似（抗噪），NCC 峰值
///   位置即真实滚动量。相比精确 memcmp，对手动滚动/动画中间态鲁棒。
///
/// 返回 `None`：无足够相关峰值（未滚动 / 内容变化 / 无重叠）。
/// 仅测试引用（滚动会话用 `overlap_offset_debug`）。
#[allow(dead_code)]
pub fn overlap_offset(
    prev: &crate::screenshot_shared::capture::OwnedBgraFrame,
    next: &crate::screenshot_shared::capture::OwnedBgraFrame,
    _row_template: u32,
) -> Option<u32> {
    if prev.width != next.width {
        return None;
    }
    let width = prev.width as usize;
    let prev_h = prev.height as usize;
    let next_h = next.height as usize;
    if width < 8 || prev_h < 8 || next_h < 8 {
        return None;
    }

    // 中间列带：忽略左右 `max(50, 宽/20)`，滚动条/窗口边框在两侧。
    let ignore_side = (50usize).max(width / 20).min(width / 3);
    let band_start = ignore_side;
    let band_end = width - ignore_side;
    if band_end <= band_start {
        return None;
    }

    // 行灰度投影（每行列带均值）。
    let profile = |frame: &crate::screenshot_shared::capture::OwnedBgraFrame| -> Vec<f32> {
        let h = frame.height as usize;
        let mut out = vec![0f32; h];
        for (y, out_row) in out.iter_mut().enumerate() {
            let row_base = y * width;
            let mut sum: u64 = 0;
            let mut count: u64 = 0;
            for x in band_start..band_end {
                let off = (row_base + x) * 4;
                // 简单亮度：0.299R + 0.587G + 0.114B
                sum += (299 * frame.buffer[off] as u64
                    + 587 * frame.buffer[off + 1] as u64
                    + 114 * frame.buffer[off + 2] as u64)
                    / 1000;
                count += 1;
            }
            *out_row = sum as f32 / count.max(1) as f32;
        }
        out
    };

    let prev_p = profile(prev);
    let next_p = profile(next);

    // 搜索域：`min(半屏, 最大滚动量 400px)`。
    let search_limit = (prev_h / 2).min(400);

    // 对每个候选 S，算 next[0..n] 与 prev[S..S+n] 的 NCC。
    // 用「重叠区长度」约束：取 n = min(next_h, prev_h - s)。
    // 只比较底部 70% 的重叠带：顶部常被固定导航栏/标题占据（滚动时不动），
    // 用它对齐会误判 s=0；底部是滚动正文，位移可检测。
    let mut best_s = None::<usize>;
    let mut best_score = f64::MIN;
    for s in 0..=search_limit {
        let n = next_h.min(prev_h - s);
        if n < 16 {
            continue;
        }
        let band_rows = n * 70 / 100;
        if band_rows < 16 {
            continue;
        }
        let band_offset = n - band_rows; // 底部 band_rows 行（跳过顶部固定区）
        let mut sum_next = 0f64;
        let mut sum_prev = 0f64;
        let mut sum_sq_next = 0f64;
        let mut sum_sq_prev = 0f64;
        let mut sum_prod = 0f64;
        for r in 0..band_rows {
            let a = f64::from(next_p[band_offset + r]);
            let b = f64::from(prev_p[s + band_offset + r]);
            sum_next += a;
            sum_prev += b;
            sum_sq_next += a * a;
            sum_sq_prev += b * b;
            sum_prod += a * b;
        }
        let m = band_rows as f64;
        let denom =
            ((m * sum_sq_next - sum_next * sum_next) * (m * sum_sq_prev - sum_prev * sum_prev))
                .sqrt();
        if denom <= 1e-9 {
            continue;
        }
        let ncc = (m * sum_prod - sum_next * sum_prev) / denom;
        if ncc > best_score {
            best_score = ncc;
            best_s = Some(s);
        }
    }

    // 需要 NCC ≥ 0.5 才算可信（网页平滑滚动下投影相关度仍应较高）。
    let s = best_s?;
    if best_score < 0.5 {
        return None;
    }
    // 滚动量为 0：内容没动，不拼接。
    if s == 0 {
        return None;
    }
    // crop_top = prev.height - S（next 顶部需裁掉的重叠行数）。
    let crop_top = prev.height as usize - s;
    if crop_top == 0 || crop_top >= next.height as usize {
        return None;
    }
    Some(crop_top as u32)
}

/// `overlap_offset` 的诊断变体：返回 `(crop_top, best_s, best_ncc, ncc_at_zero)`。
///
/// 与 `overlap_offset` 算法相同（行灰度投影 + NCC），失败时也能返回最佳
/// 候选位置与 NCC 分数，供调用方区分「内容没变」与「内容变了但相关度低」。
/// `ncc_at_zero` 是 s=0（无滚动）处的相关度，用于判断顶部内容是否相似。
pub fn overlap_offset_debug(
    prev: &crate::screenshot_shared::capture::OwnedBgraFrame,
    next: &crate::screenshot_shared::capture::OwnedBgraFrame,
    _row_template: u32,
) -> Option<(u32, usize, f64, f64)> {
    if prev.width != next.width {
        return None;
    }
    let width = prev.width as usize;
    let prev_h = prev.height as usize;
    let next_h = next.height as usize;
    if width < 8 || prev_h < 8 || next_h < 8 {
        return None;
    }

    let ignore_side = (50usize).max(width / 20).min(width / 3);
    let band_start = ignore_side;
    let band_end = width - ignore_side;
    if band_end <= band_start {
        return None;
    }

    let profile = |frame: &crate::screenshot_shared::capture::OwnedBgraFrame| -> Vec<f32> {
        let h = frame.height as usize;
        let mut out = vec![0f32; h];
        for (y, out_row) in out.iter_mut().enumerate() {
            let row_base = y * width;
            let mut sum: u64 = 0;
            let mut count: u64 = 0;
            for x in band_start..band_end {
                let off = (row_base + x) * 4;
                sum += (299 * frame.buffer[off] as u64
                    + 587 * frame.buffer[off + 1] as u64
                    + 114 * frame.buffer[off + 2] as u64)
                    / 1000;
                count += 1;
            }
            *out_row = sum as f32 / count.max(1) as f32;
        }
        out
    };

    let prev_p = profile(prev);
    let next_p = profile(next);

    let search_limit = (prev_h / 2).min(400);

    // NCC 计算闭包：比较 next 底部带与 prev[s..s+band]。
    let ncc_at = |s: usize| -> Option<f64> {
        let n = next_h.min(prev_h - s);
        if n < 16 {
            return None;
        }
        // 底部 70% 带（跳过顶部固定导航栏，其滚动时不动会误导对齐）。
        let band_rows = n * 70 / 100;
        if band_rows < 16 {
            return None;
        }
        let band_offset = n - band_rows;
        let mut sum_next = 0f64;
        let mut sum_prev = 0f64;
        let mut sum_sq_next = 0f64;
        let mut sum_sq_prev = 0f64;
        let mut sum_prod = 0f64;
        for r in 0..band_rows {
            let a = f64::from(next_p[band_offset + r]);
            let b = f64::from(prev_p[s + band_offset + r]);
            sum_next += a;
            sum_prev += b;
            sum_sq_next += a * a;
            sum_sq_prev += b * b;
            sum_prod += a * b;
        }
        let m = band_rows as f64;
        let denom =
            ((m * sum_sq_next - sum_next * sum_next) * (m * sum_sq_prev - sum_prev * sum_prev))
                .sqrt();
        if denom <= 1e-9 {
            return None;
        }
        Some((m * sum_prod - sum_next * sum_prev) / denom)
    };

    let ncc_at_zero = ncc_at(0).unwrap_or(0.0);
    let mut best_s = None::<usize>;
    let mut best_score = f64::MIN;
    for s in 0..=search_limit {
        if let Some(ncc) = ncc_at(s) {
            if ncc > best_score {
                best_score = ncc;
                best_s = Some(s);
            }
        }
    }

    let s = best_s?;
    if best_score < 0.5 {
        return Some((0, s, best_score, ncc_at_zero));
    }
    if s == 0 {
        return Some((0, s, best_score, ncc_at_zero));
    }
    let crop_top = prev.height as usize - s;
    if crop_top == 0 || crop_top >= next.height as usize {
        return Some((0, s, best_score, ncc_at_zero));
    }
    Some((crop_top as u32, s, best_score, ncc_at_zero))
}

/// 动态扩容的 BGRA 拼接缓冲。
#[derive(Clone, Debug)]
pub struct StitchBuffer {
    width: u32,
    height: u32,
    capacity: u32,
    data: Vec<u8>,
}

impl StitchBuffer {
    pub fn new(width: u32, initial_height: u32) -> Self {
        let capacity = initial_height.max(1);
        Self {
            width,
            height: 0,
            capacity,
            data: vec![0u8; width as usize * capacity as usize * 4],
        }
    }

    #[allow(dead_code)]
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    fn ensure_capacity(&mut self, needed_height: u32) {
        if needed_height <= self.capacity {
            return;
        }
        let mut new_cap = self.capacity.max(1);
        while new_cap < needed_height {
            new_cap = new_cap.saturating_mul(2);
        }
        let mut new_data = vec![0u8; self.width as usize * new_cap as usize * 4];
        let copy_rows = self.height as usize;
        let row_bytes = self.width as usize * 4;
        new_data[..copy_rows * row_bytes]
            .copy_from_slice(&self.data[..copy_rows * row_bytes]);
        self.capacity = new_cap;
        self.data = new_data;
    }

    /// 追加一帧：`crop_top` 行是上一帧已拼入的重复区，从该行开始复制。
    pub fn push(&mut self, frame: &crate::screenshot_shared::capture::OwnedBgraFrame, crop_top: u32) {
        if frame.width != self.width {
            return;
        }
        let crop_top = crop_top.min(frame.height);
        let new_rows = frame.height - crop_top;
        let needed = self.height + new_rows;
        self.ensure_capacity(needed);

        let row_bytes = self.width as usize * 4;
        let src = &frame.buffer[crop_top as usize * row_bytes..];
        let dst_start = self.height as usize * row_bytes;
        self.data[dst_start..dst_start + src.len()].copy_from_slice(src);
        self.height = needed;
    }

    /// 取出当前拼接结果的 BGRA 帧。
    pub fn to_frame(&self) -> crate::screenshot_shared::capture::OwnedBgraFrame {
        crate::screenshot_shared::capture::OwnedBgraFrame {
            buffer: self.data[..self.height as usize * self.width as usize * 4].to_vec(),
            width: self.width,
            height: self.height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::screenshot_shared::capture::OwnedBgraFrame;

    /// 构造一帧：每行一个伪随机亮度（LCG 按行），行间亮度独立 → profile 有指纹。
    /// 横向均匀填充该行亮度，保证行内一致、投影均值 = 行亮度。
    fn make_frame(width: u32, height: u32) -> OwnedBgraFrame {
        let mut buf = vec![0u8; width as usize * height as usize * 4];
        let mut seed = 987654321u32;
        for y in 0..height {
            // 行亮度：LCG 生成 40~215 的值（避免纯黑/纯白，保证投影区分度）。
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let v = 40 + ((seed >> 16) as u8 % 176);
            for x in 0..width {
                let idx = (y as usize * width as usize + x as usize) * 4;
                buf[idx] = v;
                buf[idx + 1] = v;
                buf[idx + 2] = v;
                buf[idx + 3] = 255;
            }
        }
        OwnedBgraFrame {
            buffer: buf,
            width,
            height,
        }
    }

    /// 截取 frame 的 [top, bottom) 行（不含 bottom）。
    fn slice_rows(frame: &OwnedBgraFrame, top: u32, bottom: u32) -> OwnedBgraFrame {
        let row_bytes = frame.width as usize * 4;
        OwnedBgraFrame {
            buffer: frame.buffer[top as usize * row_bytes..bottom as usize * row_bytes].to_vec(),
            width: frame.width,
            height: bottom - top,
        }
    }

    #[test]
    fn overlap_offset_detects_translation() {
        // 原图 200x200（每行独立亮度指纹）。prev = 原图 [0,100)，next = 原图 [30,130)（内容下滚 30px）。
        // crop_top = prev.height - S = 100 - 30 = 70（next 顶部 70 行与 prev 重叠）。
        let full = make_frame(200, 200);
        let prev = slice_rows(&full, 0, 100);
        let next = slice_rows(&full, 30, 130);
        let crop_top = overlap_offset(&prev, &next, 64).expect("应找到对齐");
        assert_eq!(crop_top, 70);
    }

    #[test]
    fn overlap_offset_returns_none_when_no_match() {
        // 两帧行亮度差异大（next 为 prev 反相），无重叠相关。
        let a = make_frame(100, 100);
        let mut b = a.clone();
        for v in b.buffer.iter_mut() {
            *v = v.wrapping_neg();
        }
        let crop_top = overlap_offset(&a, &b, 32);
        assert!(crop_top.is_none());
    }

    #[test]
    fn overlap_offset_returns_none_when_no_scroll() {
        // 内容完全一致（没滚动）→ s=0 被拦截，返回 None。
        let a = make_frame(100, 100);
        let b = slice_rows(&a, 0, 100);
        let crop_top = overlap_offset(&a, &b, 32);
        assert!(crop_top.is_none());
    }

    #[test]
    fn stitch_buffer_grows_and_appends() {
        let mut buf = StitchBuffer::new(100, 100);
        let frame = make_frame(100, 80);
        buf.push(&frame, 0); // 首帧整帧
        assert_eq!(buf.height(), 80);
        buf.push(&frame, 30); // 第二帧裁掉 30 行重复
        assert_eq!(buf.height(), 80 + 50);
        let out = buf.to_frame();
        assert_eq!(out.width, 100);
        assert_eq!(out.height, 130);
    }

    #[test]
    fn stitch_buffer_ignores_width_mismatch() {
        let mut buf = StitchBuffer::new(100, 100);
        let frame = make_frame(120, 80); // 宽度不一致
        buf.push(&frame, 0);
        assert_eq!(buf.height(), 0);
    }
}
