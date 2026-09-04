//! 贴图注册表核心：`PinRegistry` 及其状态 DTO。
//!
//! 全局注册表 `PIN_REGISTRY` 以 `OnceLock<Arc<PinRegistry>>` 承载，跨线程共享；
//! 容量记账按「解码后像素字节 + PNG 字节」计，超上限拒绝创建。`pub(super)` 的
//! 方法供 `window`/`commands`/`protocol` 子模块调用。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use specta::Type;
use uuid::Uuid;

use super::{initial_zoom_percent, OPACITY_MAX_PERCENT};

pub const PER_PIN_DECODED_CAP_BYTES: u64 = 64 * 1024 * 1024;
pub const DEFAULT_AGGREGATE_PIN_CAP_BYTES: u64 = 128 * 1024 * 1024;

pub(super) static PIN_REGISTRY: OnceLock<Arc<PinRegistry>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PinState {
    pub pin_id: String,
    pub label: String,
    pub image_token: String,
    pub width: u32,
    pub height: u32,
    pub zoom_percent: u16,
    pub opacity_percent: u8,
    pub click_through: bool,
    pub accounted_bytes: u64,
    /// 旋转角度（0/90/180/270）。
    pub rotation: u16,
    /// 水平翻转。
    pub flipped_h: bool,
    /// 垂直翻转。
    pub flipped_v: bool,
    /// 分组（0/1/2）。
    pub group: u8,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PinTrayItem {
    pub pin_id: String,
    pub label: String,
    pub zoom_percent: u16,
    pub opacity_percent: u8,
    pub click_through: bool,
}

#[derive(Clone, Debug)]
struct PinEntry {
    state: PinState,
    image_png: Arc<Vec<u8>>,
}

#[derive(Debug, Default)]
struct PinRegistryInner {
    pins: HashMap<String, PinEntry>,
    total_bytes: u64,
}

#[derive(Debug)]
pub struct PinRegistry {
    inner: Mutex<PinRegistryInner>,
    aggregate_cap_bytes: u64,
}

impl Default for PinRegistry {
    fn default() -> Self {
        Self::new(DEFAULT_AGGREGATE_PIN_CAP_BYTES)
    }
}

impl PinRegistry {
    pub fn new(aggregate_cap_bytes: u64) -> Self {
        Self {
            inner: Mutex::new(PinRegistryInner::default()),
            aggregate_cap_bytes,
        }
    }

    pub(super) fn reserve(
        &self,
        image_png: Vec<u8>,
        width: u32,
        height: u32,
    ) -> Result<PinState, String> {
        let decoded_bytes = decoded_byte_count(width, height)?;
        if decoded_bytes >= PER_PIN_DECODED_CAP_BYTES {
            return Err(format!(
                "贴图尺寸过大（解码后 {} MiB）；请裁剪图片或关闭其他贴图后重试",
                decoded_bytes / (1024 * 1024)
            ));
        }
        let accounted_bytes = decoded_bytes.saturating_add(image_png.len() as u64);
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "贴图注册表不可用".to_string())?;
        if inner.total_bytes.saturating_add(accounted_bytes) > self.aggregate_cap_bytes {
            return Err(format!(
                "贴图内存已达上限（{} MiB）；请先关闭一个贴图再重试",
                self.aggregate_cap_bytes / (1024 * 1024)
            ));
        }

        let pin_id = Uuid::new_v4().to_string();
        let label = format!("pin-{pin_id}");
        let image_token = Uuid::new_v4().to_string();
        let initial_zoom = initial_zoom_percent(width, height);
        let state = PinState {
            pin_id: pin_id.clone(),
            label,
            image_token,
            width,
            height,
            zoom_percent: initial_zoom,
            opacity_percent: OPACITY_MAX_PERCENT,
            click_through: false,
            accounted_bytes,
            rotation: 0,
            flipped_h: false,
            flipped_v: false,
            group: 0,
        };
        inner.total_bytes = inner.total_bytes.saturating_add(accounted_bytes);
        inner.pins.insert(
            pin_id,
            PinEntry {
                state: state.clone(),
                image_png: Arc::new(image_png),
            },
        );
        Ok(state)
    }

    pub(super) fn get(&self, pin_id: &str) -> Result<PinState, String> {
        self.inner
            .lock()
            .map_err(|_| "贴图注册表不可用".to_string())?
            .pins
            .get(pin_id)
            .map(|entry| entry.state.clone())
            .ok_or_else(|| "贴图不存在或已关闭".to_string())
    }

    pub(super) fn image(&self, pin_id: &str, token: &str) -> Result<Vec<u8>, String> {
        let image_png = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "贴图注册表不可用".to_string())?;
            let entry = inner
                .pins
                .get(pin_id)
                .ok_or_else(|| "贴图不存在或已关闭".to_string())?;
            if entry.state.image_token != token {
                return Err("贴图图像令牌无效".to_string());
            }
            // 锁内只 clone Arc（廉价）；完整 PNG 拷贝放到锁外，避免阻塞其它贴图操作。
            Arc::clone(&entry.image_png)
        };
        Ok(image_png.as_ref().clone())
    }

    /// Commit an already-applied native target state. The state comparison makes
    /// a close racing a native call a controlled failure rather than a stale
    /// state write into a recreated pin entry.
    pub(super) fn commit_state(
        &self,
        pin_id: &str,
        previous: &PinState,
        target: PinState,
    ) -> Result<PinState, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "贴图注册表不可用".to_string())?;
        let entry = inner
            .pins
            .get_mut(pin_id)
            .ok_or_else(|| "贴图不存在或已关闭".to_string())?;
        if entry.state != *previous {
            return Err("贴图状态已变更，请重试".to_string());
        }
        entry.state = target.clone();
        Ok(target)
    }

    pub fn remove(&self, pin_id: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let Some(entry) = inner.pins.remove(pin_id) else {
            return false;
        };
        inner.total_bytes = inner
            .total_bytes
            .saturating_sub(entry.state.accounted_bytes);
        true
    }

    pub(super) fn snapshot_states(&self) -> Result<Vec<PinState>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "贴图注册表不可用".to_string())?
            .pins
            .values()
            .map(|entry| entry.state.clone())
            .collect())
    }

    pub(crate) fn tray_items(&self) -> Result<Vec<PinTrayItem>, String> {
        self.snapshot_states().map(|states| {
            states
                .into_iter()
                .map(|state| PinTrayItem {
                    pin_id: state.pin_id,
                    label: state.label,
                    zoom_percent: state.zoom_percent,
                    opacity_percent: state.opacity_percent,
                    click_through: state.click_through,
                })
                .collect()
        })
    }

    pub(super) fn ids(&self) -> Result<Vec<String>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "贴图注册表不可用".to_string())?
            .pins
            .keys()
            .cloned()
            .collect())
    }

    #[cfg(test)]
    fn total_bytes(&self) -> u64 {
        self.inner.lock().unwrap().total_bytes
    }
}

/// 获取全局贴图注册表（运行时建贴图窗口也走这里，不重复预热）。
pub(super) fn pin_registry() -> Arc<PinRegistry> {
    PIN_REGISTRY
        .get_or_init(|| Arc::new(PinRegistry::default()))
        .clone()
}

fn decoded_byte_count(width: u32, height: u32) -> Result<u64, String> {
    u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "贴图尺寸导致内存计数溢出".to_string())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn valid_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(4, 3, image::Rgba([1, 2, 3, 255]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn commit_state_requires_the_expected_previous_state() {
        let registry = PinRegistry::new(1_000_000);
        let previous = registry.reserve(valid_png(), 4, 3).unwrap();
        let target = PinState {
            zoom_percent: 150,
            ..previous.clone()
        };
        assert_eq!(
            registry
                .commit_state(&previous.pin_id, &previous, target.clone())
                .unwrap(),
            target
        );

        let stale_target = PinState {
            opacity_percent: 70,
            ..previous.clone()
        };
        assert!(registry
            .commit_state(&previous.pin_id, &previous, stale_target)
            .is_err());
        assert_eq!(registry.get(&previous.pin_id).unwrap().zoom_percent, 150);
    }

    #[test]
    fn commit_state_does_not_change_memory_accounting() {
        let registry = PinRegistry::new(1_000_000);
        let previous = registry.reserve(valid_png(), 4, 3).unwrap();
        let accounted_bytes = registry.total_bytes();
        let target = PinState {
            click_through: true,
            ..previous.clone()
        };

        registry
            .commit_state(&previous.pin_id, &previous, target)
            .unwrap();
        assert_eq!(registry.total_bytes(), accounted_bytes);
    }

    #[test]
    fn registry_accounts_and_close_is_idempotent() {
        let registry = PinRegistry::new(1_000_000);
        let state = registry.reserve(valid_png(), 4, 3).unwrap();
        assert_eq!(registry.total_bytes(), state.accounted_bytes);
        assert!(registry.remove(&state.pin_id));
        assert_eq!(registry.total_bytes(), 0);
        assert!(!registry.remove(&state.pin_id));
        assert_eq!(registry.total_bytes(), 0);
    }

    #[test]
    fn registry_rejects_cap_before_insert() {
        let registry = PinRegistry::new(10);
        assert!(registry.reserve(valid_png(), 4, 3).is_err());
        assert_eq!(registry.total_bytes(), 0);
    }
}
