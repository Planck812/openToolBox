//! 应用统一错误类型。
//!
//! 目标：命令内部可以 `match kind` 结构化区分错误；对外通过 `Serialize`
//! 保持 message 字符串序列化（与历史 `Result<_, String>` 完全一致，前端零改动）。
//!
//! 约定：
//! - 新增领域错误优先使用结构化变体（`InvalidInput`/`NotFound`/`External` 等）；
//! - 从旧代码迁移时，`String` 错误统一落入 [`AppError::Message`]；
//! - `?` 可自动转换 `String` / `&str` / `io::Error` / `serde_json::Error` /
//!   `FromUtf8Error`（见各 `From`/`#[from]` 实现）。

use serde::ser::Serializer;
use serde::Serialize;
use specta::datatype::{DataType, Primitive};
use specta::{Type, Types};

/// 应用统一错误类型：内部可 match 结构化错误，对外序列化为 message 字符串（兼容前端）。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("IO 错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("UTF-8 错误：{0}")]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("无效输入：{0}")]
    InvalidInput(String),
    #[error("未找到：{0}")]
    NotFound(String),
    #[error("外部命令失败：{0}")]
    External(String),
}

impl AppError {
    pub fn invalid_input(msg: impl Into<String>) -> Self {
        Self::InvalidInput(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Message(s.to_string())
    }
}

/// 让命令体内 `?` 传播旧式 `Result<_, String>` 辅助函数时自动落为 [`AppError::Message`]，
/// 减少迁移期的显式包装。
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Message(s)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// tauri-specta 类型导出支持：`AppError` 对外序列化为 message 字符串（见上方 `Serialize`），
/// 故其 specta 类型等价于 `string`。不能 `derive(Type)`（`Io(io::Error)`/`Json(serde_json::Error)`/
/// `Utf8(FromUtf8Error)` 变体字段无 specta `Type` 实现），手写实现保持与 wire format 一致。
impl Type for AppError {
    fn definition(_types: &mut Types) -> DataType {
        DataType::Primitive(Primitive::str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 对外序列化必须是 message 字符串（兼容前端 `Result<_, String>` 的 rejection 契约）。
    #[test]
    fn serializes_as_message_string() {
        assert_eq!(
            serde_json::to_value(AppError::Message("读取失败".into())).unwrap(),
            serde_json::Value::String("读取失败".into())
        );
        // 结构化变体同样对外展开为 message 字符串。
        assert_eq!(
            serde_json::to_value(AppError::InvalidInput("参数无效".into())).unwrap(),
            serde_json::Value::String("无效输入：参数无效".into())
        );
    }

    #[test]
    fn from_string_and_str_map_to_message() {
        let from_str: AppError = "plain".into();
        assert!(matches!(from_str, AppError::Message(m) if m == "plain"));
        let from_string: AppError = "owned".to_string().into();
        assert!(matches!(from_string, AppError::Message(m) if m == "owned"));
    }
}
