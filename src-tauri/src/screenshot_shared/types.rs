//! Shared DTOs, IDs, geometry units, and error codes for screenshot capture.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Signed physical desktop point in virtual-desktop coordinates.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDesktopPointI32 {
    pub x: i32,
    pub y: i32,
}

/// Half-open physical desktop rectangle `[left, right) × [top, bottom)`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDesktopRectI32 {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PhysicalDesktopRectI32 {
    /// 非 Windows 构建的 xcap 路径与测试使用；Windows 构建走 DXGI 不调用。
    #[allow(dead_code)]
    pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> Option<Self> {
        let rect = Self {
            left,
            top,
            right,
            bottom,
        };
        rect.is_valid().then_some(rect)
    }

    pub fn width(self) -> Option<u32> {
        u32::try_from(i64::from(self.right).checked_sub(i64::from(self.left))?).ok()
    }

    pub fn height(self) -> Option<u32> {
        u32::try_from(i64::from(self.bottom).checked_sub(i64::from(self.top))?).ok()
    }

    pub fn is_valid(self) -> bool {
        self.width().is_some_and(|w| w > 0) && self.height().is_some_and(|h| h > 0)
    }
}

/// Monitor bounds in physical virtual-desktop coordinates.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorPhysicalRectI32 {
    pub desktop: PhysicalDesktopRectI32,
}

/// Overlay-local CSS point (logical pixels for a single monitor).
///
/// Reserved: consumed by 07-22-screenshot-annotations-actions (annotation layer).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCssPointF64 {
    pub x: f64,
    pub y: f64,
}

/// Overlay-local CSS rectangle (half-open logical pixels).
///
/// Reserved: consumed by 07-22-screenshot-annotations-actions (annotation layer).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCssRectF64 {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// Structured capture / session error codes for IPC and recovery.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenshotErrorCode {
    UnsupportedPlatform,
    StaleGeneration,
    TopologyChanged,
    SessionBusy,
    NoOutputs,
    CaptureFailed,
    AccessLost,
    DeviceLost,
    AcquireTimeout,
    InvalidSelection,
    Cancelled,
    Internal,
}

impl ScreenshotErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::StaleGeneration => "stale_generation",
            Self::TopologyChanged => "topology_changed",
            Self::SessionBusy => "session_busy",
            Self::NoOutputs => "no_outputs",
            Self::CaptureFailed => "capture_failed",
            Self::AccessLost => "access_lost",
            Self::DeviceLost => "device_lost",
            Self::AcquireTimeout => "acquire_timeout",
            Self::InvalidSelection => "invalid_selection",
            Self::Cancelled => "cancelled",
            Self::Internal => "internal",
        }
    }

    /// User-facing Chinese message matching existing command style.
    pub fn user_message(self) -> &'static str {
        match self {
            Self::UnsupportedPlatform => "当前平台不支持截图",
            Self::StaleGeneration => "截图会话已过期",
            Self::TopologyChanged => "显示器布局已变化，请重试",
            Self::SessionBusy => "已有截图会话进行中",
            Self::NoOutputs => "未找到可用显示器",
            Self::CaptureFailed => "截屏失败",
            Self::AccessLost => "截屏权限丢失，请重试",
            Self::DeviceLost => "显卡设备丢失，请重试",
            Self::AcquireTimeout => "截屏超时",
            Self::InvalidSelection => "选区无效",
            Self::Cancelled => "已取消截图",
            Self::Internal => "截图内部错误",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotError {
    pub code: ScreenshotErrorCode,
    pub message: String,
}

impl ScreenshotError {
    pub fn new(code: ScreenshotErrorCode) -> Self {
        Self {
            message: code.user_message().to_string(),
            code,
        }
    }

    pub fn with_message(code: ScreenshotErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ScreenshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl From<ScreenshotError> for String {
    fn from(value: ScreenshotError) -> Self {
        value.message
    }
}

/// Trigger source for a screenshot session.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenshotTriggerSource {
    GlobalShortcut,
    Tray,
    HistoryPage,
    Command,
}

/// Snapshot of main window state before hide, used for restore.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowSnapshot {
    pub exists: bool,
    pub was_visible: bool,
    pub was_minimized: bool,
    pub was_focused: bool,
    pub outer_x: Option<i32>,
    pub outer_y: Option<i32>,
    pub outer_width: Option<u32>,
    pub outer_height: Option<u32>,
    pub route_token: Option<String>,
    pub trigger: ScreenshotTriggerSource,
}

impl Default for MainWindowSnapshot {
    fn default() -> Self {
        Self {
            exists: false,
            was_visible: false,
            was_minimized: false,
            was_focused: false,
            outer_x: None,
            outer_y: None,
            outer_width: None,
            outer_height: None,
            route_token: None,
            trigger: ScreenshotTriggerSource::Command,
        }
    }
}

/// Result returned when cancelling a session.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CancelSessionResult {
    pub cancelled: bool,
    pub session_id: Option<String>,
    pub generation: Option<u64>,
}
