//! macOS「打断型」悬浮窗：让快捷唤起面板与久坐提醒弹窗出现在用户**当前所在的
//! 桌面空间**上，包括全屏应用独占的 Space，且不把用户从全屏里踢出来。
//!
//! # 为什么普通 NSWindow 做不到（实测结论）
//!
//! 依次试过并被实测否定的做法：
//!
//! 1. `always_on_top` —— tao 只是把层级抬到 `NSFloatingWindowLevel`(3)。它管的是
//!    同一 Space 内的前后顺序，不管窗口属于哪个 Space。
//! 2. 追加 `visible_on_all_workspaces`（`CanJoinAllSpaces`）—— 能跨**普通** Space，
//!    全屏应用的 Space 依然进不去。
//! 3. 再追加 `FullScreenAuxiliary` 并把层级抬到 `NSStatusWindowLevel`(25) ——
//!    **仍然不行**（在全屏 Terminal 中实测）。
//!
//! 根因在于「抢焦点」有两条彼此独立的路径，只堵一条无效：
//!
//! - **窗口成为 key window**：由窗口类决定，需 NSPanel 且 `canBecomeKeyWindow` 可控；
//! - **应用被激活**：由样式位决定，需 `NSWindowStyleMaskNonactivatingPanel`。
//!
//! 普通 NSWindow 无法表达「非激活」语义，因此必须把窗口变成 NSPanel。这也是
//! Spotlight / Alfred / Raycast 这类浮层的通行做法。
//!
//! # 做法
//!
//! 用 `object_setClass` 把 Tauri 创建的 NSWindow 就地改类为一个 NSPanel 子类
//! （不重建窗口，webview 与既有状态原样保留），随后设置：
//!
//! - 样式位加上 `NonactivatingPanel`：点击/显示不激活本应用，用户留在全屏里；
//! - 层级 `NSStatusWindowLevel`(25)：高于主菜单层，能盖住全屏应用内容；
//! - collectionBehavior 加 `CanJoinAllSpaces | Stationary | FullScreenAuxiliary`；
//! - `setHidesOnDeactivate: NO`：**关键且反直觉** —— NSPanel 默认在应用失活时自动
//!   隐藏，而非激活式浮层的应用本就长期处于失活状态，不关掉这条 panel 会瞬间消失。
//!
//! 子类重写 `canBecomeKeyWindow` 返回 YES：面板需要接收键盘输入（快捷面板要打字），
//! 但因带 `NonactivatingPanel` 样式位，成为 key window 并不会激活整个应用。
//!
//! # 线程约束
//!
//! AppKit 窗口操作必须在主线程执行；调用方需保证这一点（Tauri 的 `setup` 回调与
//! `run_on_main_thread` 均满足）。

/// `NSWindowStyleMaskNonactivatingPanel`：面板获得焦点时不激活所属应用。
#[cfg(target_os = "macos")]
const STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
/// `NSWindowCollectionBehaviorCanJoinAllSpaces`：出现在所有普通 Space 上。
#[cfg(target_os = "macos")]
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
/// `NSWindowCollectionBehaviorStationary`：切换 Space 时不参与随行动画。
#[cfg(target_os = "macos")]
const STATIONARY: usize = 1 << 4;
/// `NSWindowCollectionBehaviorFullScreenAuxiliary`：可与全屏窗口共处同一 Space。
#[cfg(target_os = "macos")]
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
/// `NSStatusWindowLevel`：高于主菜单层(24)，低于弹出菜单(101)与屏保(1000)。
#[cfg(target_os = "macos")]
const STATUS_WINDOW_LEVEL: isize = 25;

/// 惰性注册并返回 NSPanel 子类；注册失败（重名/取不到 NSPanel）返回 None。
///
/// 全进程只注册一次：Objective-C 运行时不允许重复注册同名类。
#[cfg(target_os = "macos")]
fn overlay_panel_class() -> Option<&'static objc2::runtime::AnyClass> {
    use objc2::runtime::{AnyClass, Bool, ClassBuilder, Sel};
    use objc2::sel;
    use std::sync::OnceLock;

    static CLASS: OnceLock<Option<usize>> = OnceLock::new();

    let addr = (*CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSPanel")?;
        let mut builder = ClassBuilder::new(c"OpenToolboxOverlayPanel", superclass)?;

        // 面板需要接收键盘输入（快捷面板要打字搜索）。配合 NonactivatingPanel
        // 样式位，成为 key window 不会激活本应用，用户仍留在原应用/全屏中。
        extern "C" fn can_become_key_window(_: &objc2::runtime::NSObject, _: Sel) -> Bool {
            Bool::YES
        }
        // 不接管「主窗口」身份：主窗口切换会牵动应用级激活语义，浮层不需要。
        extern "C" fn can_become_main_window(_: &objc2::runtime::NSObject, _: Sel) -> Bool {
            Bool::NO
        }

        // SAFETY: 两个方法签名与 NSWindow 上同名方法一致（无参、返回 BOOL），
        // 且 Callee 为 NSObject（NSPanel 的祖先），符合 objc2 的调用约定要求。
        unsafe {
            builder.add_method(
                sel!(canBecomeKeyWindow),
                can_become_key_window as extern "C" fn(_, _) -> _,
            );
            builder.add_method(
                sel!(canBecomeMainWindow),
                can_become_main_window as extern "C" fn(_, _) -> _,
            );
        }
        Some(builder.register() as *const AnyClass as usize)
    }))?;

    // SAFETY: 地址来自上面 `register()` 返回的 'static 类对象，注册后永久有效。
    Some(unsafe { &*(addr as *const AnyClass) })
}

/// 记录被改类窗口的**原类**，键为窗口 label，值为 `Class` 指针地址。
///
/// 必须还原，否则窗口销毁时崩溃：WebKit 会在 NSWindow 上注册 KVO 观察者，而 KVO
/// 的实现正是动态生成 `NSKVONotifying_<原类>` 子类并改写对象的 isa。若在 KVO 注册
/// 之后 `object_setClass`，这层 KVO 子类被覆盖；等 webview 随窗口销毁去注销观察者时
/// （`-[NSView removeFromSuperview]` → `WKWindowVisibilityObserver stopObserving`
/// → `removeObserver:forKeyPath:`），KVO 找不到登记记录而抛异常 → SIGABRT。
///
/// `object_setClass` 返回改类前的类 —— KVO 已注册时返回的正是那层 KVO 子类，
/// 因此销毁前把它设回去，KVO 状态即完好如初。
#[cfg(target_os = "macos")]
static ORIGINAL_CLASSES: std::sync::Mutex<Option<std::collections::HashMap<String, usize>>> =
    std::sync::Mutex::new(None);

/// 本模块只需要窗口的 label 与 NSWindow 指针。抽成 trait 是因为调用点分布在
/// `WebviewWindow`（建窗处）与 `Window`（`on_window_event` 回调）两种类型上，
/// 二者接口一致但无公共父 trait。
pub(crate) trait OverlayWindow {
    fn overlay_label(&self) -> String;
    #[cfg(target_os = "macos")]
    fn overlay_ns_window(&self) -> Option<*mut std::ffi::c_void>;
}

impl<R: tauri::Runtime> OverlayWindow for tauri::WebviewWindow<R> {
    fn overlay_label(&self) -> String {
        self.label().to_string()
    }
    #[cfg(target_os = "macos")]
    fn overlay_ns_window(&self) -> Option<*mut std::ffi::c_void> {
        self.ns_window().ok().filter(|p| !p.is_null())
    }
}

impl<R: tauri::Runtime> OverlayWindow for tauri::Window<R> {
    fn overlay_label(&self) -> String {
        self.label().to_string()
    }
    #[cfg(target_os = "macos")]
    fn overlay_ns_window(&self) -> Option<*mut std::ffi::c_void> {
        self.ns_window().ok().filter(|p| !p.is_null())
    }
}

/// 把面板前置并设为 key window，但**不激活本应用**。
///
/// 不能用 Tauri/tao 的 `set_focus()`：它内部除 `makeKeyAndOrderFront:` 外还会调用
/// `activateIgnoringOtherApps:YES` 激活整个应用。一旦应用被激活，面板关闭后 macOS
/// 会退回到本应用剩余的窗口（主窗口），把用户从原来的全屏应用/Space 里拽走
/// （实测：点提醒上的「已起身」后跳回工具箱主页面）。
///
/// 配合 `NonactivatingPanel` 样式位，`makeKeyAndOrderFront:` 可让面板接收键盘与
/// 点击而不夺走应用级焦点，用户始终留在原应用中。
///
/// **必须在主线程调用。**
pub(crate) fn focus_panel_without_activating<W: OverlayWindow + ?Sized>(window: &W) {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        let Some(ptr) = window.overlay_ns_window() else {
            return;
        };
        let ns_window = ptr as *mut AnyObject;
        // SAFETY: 指针来自 Tauri 的 `ns_window()`，指向存活的 NSWindow；
        // `makeKeyAndOrderFront:` 接受可空 sender，传 null 等价于 Objective-C 的 nil。
        unsafe {
            let _: () = msg_send![ns_window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

/// 还原窗口的原类。**必须在窗口关闭/销毁前调用**，否则见 `ORIGINAL_CLASSES` 注释。
///
/// 未被改类过的窗口为空操作。还原后窗口失去 NSPanel 行为（仅用于销毁前，无影响）。
///
/// **必须在主线程调用。**
pub(crate) fn restore_window_class<W: OverlayWindow + ?Sized>(window: &W) {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::{AnyClass, NSObject};

        unsafe extern "C" {
            fn object_setClass(obj: *mut NSObject, cls: *const AnyClass) -> *const AnyClass;
        }

        let label = window.overlay_label();
        let Ok(mut guard) = ORIGINAL_CLASSES.lock() else {
            return;
        };
        let Some(map) = guard.as_mut() else {
            return;
        };
        let Some(addr) = map.remove(&label) else {
            return;
        };
        let Some(ptr) = window.overlay_ns_window() else {
            return;
        };
        // SAFETY: addr 来自 `object_setClass` 的返回值（该窗口改类前的类对象，
        // 由运行时持有、生命周期长于窗口）；ptr 指向仍存活的同一 NSWindow。
        unsafe {
            object_setClass(ptr as *mut NSObject, addr as *const AnyClass);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

/// 把窗口就地转换为「跨 Space 非激活悬浮面板」。
///
/// 幂等：重复调用只会重复设置同样的属性，不会二次改类（改类后类名已变）。
/// 任一步骤取不到对象时静默返回 —— 这是行为增强，不应影响窗口本身的创建与显示。
///
/// 调用方**必须**在窗口关闭/销毁前配对调用 [`restore_window_class`]，原因见
/// `ORIGINAL_CLASSES` 的注释（否则 WebKit 注销 KVO 观察者时崩溃）。
///
/// **必须在主线程调用。**
pub(crate) fn make_window_float_across_spaces<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::{AnyClass, AnyObject, Bool};
        use objc2::{msg_send, runtime::NSObject};

        unsafe extern "C" {
            fn object_setClass(obj: *mut NSObject, cls: *const AnyClass) -> *const AnyClass;
        }

        let Ok(ptr) = window.ns_window() else {
            return;
        };
        if ptr.is_null() {
            return;
        }
        let ns_window = ptr as *mut AnyObject;

        // 就地改类为 NSPanel 子类。窗口对象本身与其 contentView（webview）不受影响。
        if let Some(class) = overlay_panel_class() {
            // SAFETY: 指针来自 Tauri 的 `ns_window()`，指向存活的 NSWindow；目标类
            // 是 NSPanel 的子类，与 NSWindow 实例布局兼容（NSPanel 继承自 NSWindow，
            // 未新增实例变量）。
            let previous = unsafe { object_setClass(ns_window as *mut NSObject, class) };
            // 保存原类以便销毁前还原（KVO 依赖，见 ORIGINAL_CLASSES 注释）。
            // 仅首次记录：重复调用时 previous 已是本 panel 类，覆盖会丢失真正的原类。
            if !previous.is_null() {
                if let Ok(mut guard) = ORIGINAL_CLASSES.lock() {
                    guard
                        .get_or_insert_with(std::collections::HashMap::new)
                        .entry(window.label().to_string())
                        .or_insert(previous as usize);
                }
            }
        }

        // SAFETY: 以下均为 NSWindow/NSPanel 的整型或布尔属性读写，值语义、无所有权转移。
        unsafe {
            // 非激活样式位：显示与点击都不把本应用切到前台。
            let style: usize = msg_send![ns_window, styleMask];
            let next_style = style | STYLE_MASK_NONACTIVATING_PANEL;
            if next_style != style {
                let _: () = msg_send![ns_window, setStyleMask: next_style];
            }

            let behavior: usize = msg_send![ns_window, collectionBehavior];
            let next_behavior =
                behavior | CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY;
            if next_behavior != behavior {
                let _: () = msg_send![ns_window, setCollectionBehavior: next_behavior];
            }

            // 仅在更低时抬高，不降级调用方刻意设得更高的窗口。
            let level: isize = msg_send![ns_window, level];
            if level < STATUS_WINDOW_LEVEL {
                let _: () = msg_send![ns_window, setLevel: STATUS_WINDOW_LEVEL];
            }

            // NSPanel 默认随应用失活而隐藏；非激活浮层的应用长期处于失活态，
            // 不关掉这条面板会立刻消失（这是本方案中最易漏、症状最迷惑的一步）。
            let _: () = msg_send![ns_window, setHidesOnDeactivate: Bool::NO];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}
