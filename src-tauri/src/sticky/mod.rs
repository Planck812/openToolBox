//! 便利贴工具模块。
//!
//! 类似 Sticky Notes：快捷键贴出文本便利贴，可选颜色（默认浅绿）、分组、
//! 自动保存、置顶、可缩放/关闭。数据存 Tauri store，窗口复用 pin 的透明/
//! 置顶/无边框/独立 WebView2 数据目录模式。
//!
//! 并发与一致性：`sticky_create` / `sticky_show_group` 是 async command
//! （后台线程创建 WebView），`sticky_update` / `sticky_delete` / `sticky_list`
//! 是同步 command（主线程）。所有对 store 的「读-改-写」都经 `StickyState::store_lock`
//! 串行化，避免并发下整组数组互相覆盖（丢便利贴）。`upsert_note` 保证同一 id
//! 在 store 中最多一份，杜绝「删除一个便利贴删了全组」。

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

/// 便利贴窗口路由（vite 多入口）。
const STICKY_WINDOW_APP_ROUTE: &str = "sticky.html";
/// store 中的便利贴数据 key。
const STICKY_STORE_KEY: &str = "sticky_notes:notes";
/// store 文件名。
const STICKY_STORE_FILE: &str = "sticky_notes.json";
/// 单便利贴固定 id（唯一实例：数据 + 窗口）。满足 `is_valid_note_id`（`sn-` 前缀、
/// 无路径分隔符），可安全用作窗口 label 后缀与 WebView 数据目录名。
pub const SINGLE_NOTE_ID: &str = "sn-single";

/// 便利贴数据（持久化到 store）。
#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct StickyNoteData {
    pub id: String,
    pub text: String,
    /// 预设色 key（mint/yellow/blue/pink/purple）。
    pub color: String,
    /// 分组名。
    pub group: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 单便利贴开关状态（`sticky_single_toggle` / `sticky_single_status` 返回）。
#[derive(Serialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct StickySingleStatus {
    /// toggle 后 / 当前单便利贴窗口是否可见。
    pub open: bool,
}

/// 便利贴运行状态。
pub struct StickyState {
    /// 串行化所有 store「读-改-写」。async（后台线程）与主线程命令并发时，
    /// 全数组读-改-写互相覆盖会丢便利贴；加锁后同一时刻只有一个命令改数组。
    store_lock: Mutex<()>,
}

impl StickyState {
    pub fn new() -> Self {
        Self {
            store_lock: Mutex::new(()),
        }
    }
}

/// 把 `note` 合并进 `notes`：id 已存在则替换第一个并移除其余同 id 项（去重，
/// 保证同一 id 最多一份）；否则追加。防止 store 中出现重复 id，从根上杜绝
/// 「删除一个便利贴删了全组」。
fn upsert_note(mut notes: Vec<StickyNoteData>, note: StickyNoteData) -> Vec<StickyNoteData> {
    let id = note.id.clone();
    if notes.iter().any(|n| n.id == id) {
        let mut replaced = false;
        notes = notes
            .into_iter()
            .filter_map(|n| {
                if n.id == id {
                    if replaced {
                        // 重复 id 项：丢弃。
                        None
                    } else {
                        replaced = true;
                        Some(note.clone())
                    }
                } else {
                    Some(n)
                }
            })
            .collect();
    } else {
        notes.push(note);
    }
    notes
}

/// 删除指定 id 的便利贴（保留其余）。id 为空时保守处理：不删任何数据。
fn delete_note_by_id(notes: Vec<StickyNoteData>, id: &str) -> Vec<StickyNoteData> {
    if id.is_empty() {
        return notes;
    }
    notes.into_iter().filter(|n| n.id != id).collect()
}

/// 单便利贴默认记录（首次打开无历史时创建，与 `sticky_create` 新建默认一致）。
fn default_single_note() -> StickyNoteData {
    StickyNoteData {
        id: SINGLE_NOTE_ID.to_string(),
        text: String::new(),
        color: "mint".to_string(),
        group: "default".to_string(),
        x: 100,
        y: 100,
        width: 220,
        height: 220,
    }
}

/// store 纯函数：确保 `sn-single` 在 notes 中唯一存在。
///
/// - 无 `sn-single` → 追加默认记录。
/// - 已存在 → 原样复用（不覆盖用户内容）；若病态数据出现重复 id，保留第一份并去重。
///
/// 返回 `(更新后的 notes, 单便利贴权威记录)`。
fn ensure_single_note(notes: Vec<StickyNoteData>) -> (Vec<StickyNoteData>, StickyNoteData) {
    let mut first: Option<StickyNoteData> = None;
    let mut out: Vec<StickyNoteData> = Vec::with_capacity(notes.len() + 1);
    for n in notes {
        if n.id == SINGLE_NOTE_ID {
            if first.is_none() {
                first = Some(n.clone());
                out.push(n);
            }
            // 重复 sn-single：丢弃（保留第一份）。
        } else {
            out.push(n);
        }
    }
    match first {
        Some(existing) => (out, existing),
        None => {
            let note = default_single_note();
            out.push(note.clone());
            (out, note)
        }
    }
}

/// 便利贴 id 必须为 `sn-` 前缀且不含路径分隔符/`..`，
/// 防止前端注入 `../` 等字符串逃逸 app 数据目录。
fn is_valid_note_id(id: &str) -> bool {
    id.starts_with("sn-") && !id.contains('/') && !id.contains('\\') && !id.contains("..")
}

/// 读取全部便利贴（store）。
fn read_notes<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<StickyNoteData>, String> {
    let store = app
        .store(STICKY_STORE_FILE)
        .map_err(|e| format!("打开便利贴 store 失败：{e}"))?;
    let notes = match store.get(STICKY_STORE_KEY) {
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|e| format!("解析便利贴数据失败：{e}"))?,
        None => Vec::new(),
    };
    Ok(notes)
}

/// 写入全部便利贴（store）。
fn write_notes<R: Runtime>(app: &AppHandle<R>, notes: &[StickyNoteData]) -> Result<(), String> {
    let store = app
        .store(STICKY_STORE_FILE)
        .map_err(|e| format!("打开便利贴 store 失败：{e}"))?;
    store
        .set(
            STICKY_STORE_KEY,
            serde_json::to_value(notes).map_err(|e| format!("序列化便利贴失败：{e}"))?,
        );
    store.save().map_err(|e| format!("保存便利贴失败：{e}"))
}

/// 贴出一个便利贴窗口（创建新便利贴或恢复已存的）。
///
/// - `note: None`：新建便利贴（快捷键入口），生成唯一 `sn-<uuid>` 并写 store。
/// - `note: Some(n)`：恢复已存便利贴。会从 store 取**权威数据**（避免传入的
///   过期/脏数据），并校验便利贴确实存在——若已被删除则返回错误，避免贴出
///   一个「加载不到数据的空白窗口」。
///
/// async：创建 WebView 窗口较慢，放后台线程避免阻塞主线程（同 pin_create_from_history）。
#[tauri::command(async)]
#[specta::specta]
pub fn sticky_create<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
    note: Option<StickyNoteData>,
) -> Result<StickyNoteData, AppError> {
    let data = {
        // store 读-改-写串行化；窗口创建放锁外（WebView 初始化慢，不阻塞其他命令）。
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
        match note {
            Some(n) => {
                let notes = read_notes(&app)?;
                match notes.iter().find(|x| x.id == n.id).cloned() {
                    Some(stored) => stored,
                    None => {
                        return Err(AppError::Message("便利贴不存在或已被删除".to_string()));
                    }
                }
            }
            None => {
                let note = StickyNoteData {
                    id: format!("sn-{}", uuid::Uuid::new_v4()),
                    text: String::new(),
                    color: "mint".to_string(),
                    group: "default".to_string(),
                    x: 100,
                    y: 100,
                    width: 220,
                    height: 220,
                };
                let notes = read_notes(&app)?;
                let notes = upsert_note(notes, note.clone());
                write_notes(&app, &notes)?;
                note
            }
        }
    };

    // 窗口已存在（例如被 sticky_hide_all 隐藏）：显示并聚焦，而非重复创建报错。
    let label = format!("sticky-{}", data.id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(data);
    }

    create_sticky_window(&app, &data)?;

    Ok(data)
}

/// 创建便利贴窗口（透明、置顶、无边框、可缩放）。
fn create_sticky_window<R: Runtime>(
    app: &AppHandle<R>,
    note: &StickyNoteData,
) -> Result<(), String> {
    // id 校验原先由 sticky_data_directory 在构造路径前间接承担，该函数已随共享
    // WebView2 环境移除，这里显式校验：note.id 仍会进入窗口 label。
    if !is_valid_note_id(&note.id) {
        return Err(format!("非法的便利贴 id：{}", note.id));
    }
    let url = WebviewUrl::App(STICKY_WINDOW_APP_ROUTE.into());
    let label = format!("sticky-{}", note.id);

    // 不设 data_directory：复用主窗口已就绪的 WebView2 环境。
    // 每个独立 data_directory 都会拉起一整套 msedgewebview2 进程组（探针实测
    // +6 进程 / +300MB 峰值），共享环境只多一个 renderer（+1 进程）。原注释称
    // "每个 WebView 必须独立目录，否则第二个起初始化失败"，经探针实测不成立。
    WebviewWindowBuilder::new(app, label.as_str(), url)
        .title("便利贴")
        .inner_size(note.width as f64, note.height as f64)
        .position(note.x as f64, note.y as f64)
        .min_inner_size(120.0, 120.0)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .visible(true)
        .accept_first_mouse(true)
        .build()
        .map_err(|e| format!("创建便利贴窗口失败：{e}"))?;

    Ok(())
}

/// 便利贴列表（管理入口）。
#[tauri::command]
#[specta::specta]
pub fn sticky_list<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
) -> Result<Vec<StickyNoteData>, AppError> {
    // 串行化读，避免读到写一半的中间态。
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
    read_notes(&app).map_err(AppError::Message)
}

/// 更新便利贴（自动保存：文本/颜色/分组/位置/大小）。
///
/// 同一 id 只保留一份（upsert_note 去重）；id 不存在则追加。所有读-改-写串行化。
#[tauri::command]
#[specta::specta]
pub fn sticky_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
    note: StickyNoteData,
) -> Result<(), AppError> {
    // 与 sticky_create 一致：id 必须为合法便利贴 id（sn- 前缀、无路径分隔符/`..`），
    // 防止畸形 id 逃逸数据目录或写入非法窗口 label。
    if !is_valid_note_id(&note.id) {
        return Err(AppError::Message(format!("非法的便利贴 id：{}", note.id)));
    }
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
    let notes = read_notes(&app)?;
    let notes = upsert_note(notes, note);
    write_notes(&app, &notes).map_err(AppError::Message)
}

/// 删除便利贴（从 store 移除 + 关闭窗口）。
///
/// 只删除 id 精确匹配的便利贴（filter 保留不等于 id 的），且 upsert_note 已保证
/// store 中 id 唯一，因此绝不影响其他便利贴。窗口按 label = `sticky-<id>` 精确匹配。
#[tauri::command]
#[specta::specta]
pub fn sticky_delete<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
    id: String,
) -> Result<(), AppError> {
    {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
        let notes = read_notes(&app)?;
        let remaining = delete_note_by_id(notes, &id);
        write_notes(&app, &remaining)?;
    }
    // 关闭对应窗口：精确匹配 label = sticky-<id>。
    let target_label = format!("sticky-{id}");
    if let Some(win) = app.get_webview_window(&target_label) {
        let _ = win.close();
    }
    Ok(())
}

/// 贴出某分组的全部便利贴。
///
/// 已打开的窗口（含被 sticky_hide_all 隐藏的）直接**显示**并计数，而非跳过——
/// 否则「收起全部」后无法再贴出。async：一次创建多个 WebView 窗口较慢，放后台
/// 线程避免阻塞主线程（否则 UI 卡死）。
#[tauri::command(async)]
#[specta::specta]
pub fn sticky_show_group<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
    group: String,
) -> Result<usize, AppError> {
    let notes = {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
        read_notes(&app)?
    };
    let group_notes: Vec<StickyNoteData> = notes.into_iter().filter(|n| n.group == group).collect();
    let mut count = 0;
    let mut errors = Vec::new();
    for note in &group_notes {
        let label = format!("sticky-{}", note.id);
        if let Some(win) = app.get_webview_window(&label) {
            // 已打开（可能被隐藏）：显示而非跳过。
            let _ = win.show();
            let _ = win.set_focus();
            count += 1;
            continue;
        }
        match create_sticky_window(&app, note) {
            Ok(()) => count += 1,
            Err(e) => errors.push(format!("{}: {e}", note.id)),
        }
    }
    if !errors.is_empty() {
        log::error!("[sticky] show_group 部分窗口创建失败: {}", errors.join("; "));
    }
    if errors.len() == group_notes.len() {
        return Err(AppError::Message(format!(
            "分组「{group}」窗口创建全部失败：{}",
            errors.join("; ")
        )));
    }
    Ok(count)
}

/// 收起全部便利贴窗口（不删数据）。
#[tauri::command]
#[specta::specta]
pub fn sticky_hide_all<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    for (label, _win) in app.webview_windows() {
        if label.starts_with("sticky-") {
            let _ = app.get_webview_window(&label).map(|w| w.hide());
        }
    }
    Ok(())
}

/// 单便利贴开关（Ctrl+Shift+E / 工具箱按钮）：打开 / 关闭单便利贴窗口。
///
/// 数据唯一 + 窗口唯一：
/// 1. store 锁内确保存在唯一 `sn-single` 记录（无历史则建默认空贴）。
/// 2. 锁外查 `sticky-sn-single` 窗口：
///    - 可见 → hide（再按关闭；hide 保留窗口与 WebView，再开秒回）
///    - 隐藏 → show + focus（恢复打开，不重复建窗）
///    - 不存在 → 建窗（首次打开）
///
/// async：创建 WebView 窗口较慢，放后台线程（同 `sticky_create`）。
#[tauri::command(async)]
#[specta::specta]
pub fn sticky_single_toggle<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StickyState>,
) -> Result<StickySingleStatus, AppError> {
    let data = {
        // store 读-改-写串行化；窗口操作放锁外。
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "便利贴 store 锁获取失败".to_string())?;
        let notes = read_notes(&app)?;
        let (notes, note) = ensure_single_note(notes);
        write_notes(&app, &notes)?;
        note
    };

    let label = format!("sticky-{SINGLE_NOTE_ID}");
    if let Some(win) = app.get_webview_window(&label) {
        let visible = win
            .is_visible()
            .map_err(|e| format!("查询单便利贴窗口可见性失败：{e}"))?;
        if visible {
            let _ = win.hide();
            return Ok(StickySingleStatus { open: false });
        }
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(StickySingleStatus { open: true });
    }

    create_sticky_window(&app, &data)?;
    Ok(StickySingleStatus { open: true })
}

/// 单便利贴当前开关状态（工具箱按钮初始化）：窗口存在且可见 → open:true，否则 false。
#[tauri::command]
#[specta::specta]
pub fn sticky_single_status<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, StickyState>,
) -> Result<StickySingleStatus, AppError> {
    let label = format!("sticky-{SINGLE_NOTE_ID}");
    let open = match app.get_webview_window(&label) {
        Some(win) => win.is_visible().unwrap_or(false),
        None => false,
    };
    Ok(StickySingleStatus { open })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> StickyNoteData {
        StickyNoteData {
            id: id.to_string(),
            text: String::new(),
            color: "mint".to_string(),
            group: "default".to_string(),
            x: 0,
            y: 0,
            width: 220,
            height: 220,
        }
    }

    #[test]
    fn upsert_appends_new_id() {
        let notes = vec![note("sn-1")];
        let out = upsert_note(notes, note("sn-2"));
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|n| n.id == "sn-1"));
        assert!(out.iter().any(|n| n.id == "sn-2"));
    }

    #[test]
    fn upsert_replaces_existing_id() {
        let notes = vec![note("sn-1"), note("sn-2")];
        let mut updated = note("sn-1");
        updated.text = "hello".to_string();
        let out = upsert_note(notes, updated);
        assert_eq!(out.len(), 2);
        let one = out.iter().find(|n| n.id == "sn-1").unwrap();
        assert_eq!(one.text, "hello");
        assert!(out.iter().any(|n| n.id == "sn-2"));
    }

    #[test]
    fn upsert_dedupes_duplicate_ids() {
        // 病态数据：同一 id 出现多份。更新后必须只剩一份，杜绝删除全组。
        let notes = vec![note("sn-1"), note("sn-1"), note("sn-2")];
        let mut updated = note("sn-1");
        updated.text = "x".to_string();
        let out = upsert_note(notes, updated);
        assert_eq!(out.iter().filter(|n| n.id == "sn-1").count(), 1);
        assert_eq!(out.len(), 2);
        assert_eq!(out.iter().find(|n| n.id == "sn-1").unwrap().text, "x");
    }

    #[test]
    fn delete_removes_only_matching_id() {
        let notes = vec![note("sn-1"), note("sn-2"), note("sn-3")];
        let out = delete_note_by_id(notes, "sn-2");
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|n| n.id == "sn-1"));
        assert!(out.iter().any(|n| n.id == "sn-3"));
    }

    #[test]
    fn delete_removes_all_duplicates_of_id() {
        let notes = vec![note("sn-1"), note("sn-1"), note("sn-2")];
        let out = delete_note_by_id(notes, "sn-1");
        assert_eq!(out.len(), 1);
        assert!(out.iter().any(|n| n.id == "sn-2"));
    }

    #[test]
    fn delete_empty_id_is_noop() {
        let notes = vec![note("sn-1"), note("sn-2")];
        let out = delete_note_by_id(notes, "");
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn ensure_single_note_creates_default_when_absent() {
        let notes = vec![note("sn-1"), note("sn-2")];
        let (out, single) = ensure_single_note(notes);
        assert_eq!(single.id, SINGLE_NOTE_ID);
        assert_eq!(single.text, "");
        assert_eq!(single.color, "mint");
        assert_eq!(single.group, "default");
        assert_eq!((single.x, single.y, single.width, single.height), (100, 100, 220, 220));
        assert_eq!(out.len(), 3);
        assert_eq!(out.iter().filter(|n| n.id == SINGLE_NOTE_ID).count(), 1);
        // 原便利贴不受影响。
        assert!(out.iter().any(|n| n.id == "sn-1"));
        assert!(out.iter().any(|n| n.id == "sn-2"));
    }

    #[test]
    fn ensure_single_note_reuses_existing_without_overwriting() {
        let mut existing = note(SINGLE_NOTE_ID);
        existing.text = "历史内容".to_string();
        existing.color = "pink".to_string();
        existing.group = "work".to_string();
        existing.x = 300;
        existing.y = 200;
        existing.width = 300;
        existing.height = 200;
        let notes = vec![note("sn-1"), existing.clone()];
        let (out, single) = ensure_single_note(notes);
        // 复用已存在记录，不覆盖用户内容。
        assert_eq!(single.text, "历史内容");
        assert_eq!(single.color, "pink");
        assert_eq!(single.group, "work");
        assert_eq!((single.x, single.y, single.width, single.height), (300, 200, 300, 200));
        assert_eq!(out.len(), 2);
        assert_eq!(out.iter().filter(|n| n.id == SINGLE_NOTE_ID).count(), 1);
    }

    #[test]
    fn ensure_single_note_dedupes_duplicate_single() {
        // 病态数据：sn-single 出现多份。保留第一份并去重。
        let mut existing = note(SINGLE_NOTE_ID);
        existing.text = "保留第一份".to_string();
        let notes = vec![existing.clone(), note(SINGLE_NOTE_ID), note("sn-1")];
        let (out, single) = ensure_single_note(notes);
        assert_eq!(single.text, "保留第一份");
        assert_eq!(out.iter().filter(|n| n.id == SINGLE_NOTE_ID).count(), 1);
        assert_eq!(out.len(), 2);
    }
}
