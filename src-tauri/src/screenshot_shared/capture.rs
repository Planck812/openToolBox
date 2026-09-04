//! CaptureBackend trait and snapshot shapes.

use crate::screenshot_shared::types::{
    MonitorPhysicalRectI32, PhysicalDesktopPointI32, PhysicalDesktopRectI32, ScreenshotError,
    ScreenshotErrorCode,
};

pub mod windows_dxgi;

/// Display rotation after DXGI mode mapping (normalized before compose).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureRotation {
    Identity,
    Rotate90,
    Rotate180,
    Rotate270,
    Unspecified,
}

/// Stable identity for an adapter output.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputIdentifier {
    pub adapter_index: u32,
    pub adapter_luid_high: i32,
    pub adapter_luid_low: u32,
    pub output_index: u32,
}

/// One monitor entry in a display topology.
#[derive(Clone, Debug)]
pub struct MonitorTopology {
    pub id: String,
    pub identifier: OutputIdentifier,
    pub desktop_rect: PhysicalDesktopRectI32,
    pub rotation: CaptureRotation,
    pub raster_width: u32,
    pub raster_height: u32,
    /// Scale factor as percent (e.g. 125), when available.
    pub dpi_percent: Option<u32>,
}

/// Enumerated desktop topology + stable fingerprint.
#[derive(Clone, Debug)]
pub struct DisplayTopology {
    pub fingerprint: String,
    #[allow(dead_code)]
    pub dpi_metadata_available: bool,
    #[allow(dead_code)]
    pub monitors: Vec<MonitorTopology>,
}

impl DisplayTopology {
    pub fn new(mut monitors: Vec<MonitorTopology>) -> Self {
        monitors.sort_by(|a, b| {
            (
                a.identifier.adapter_index,
                a.identifier.output_index,
                a.identifier.adapter_luid_high,
                a.identifier.adapter_luid_low,
            )
                .cmp(&(
                    b.identifier.adapter_index,
                    b.identifier.output_index,
                    b.identifier.adapter_luid_high,
                    b.identifier.adapter_luid_low,
                ))
        });
        let dpi_metadata_available =
            !monitors.is_empty() && monitors.iter().all(|m| m.dpi_percent.is_some());
        let fingerprint = topology_fingerprint(&monitors);
        Self {
            fingerprint,
            dpi_metadata_available,
            monitors,
        }
    }

    #[allow(dead_code)]
    pub fn monitor_physical_rects(&self) -> Vec<MonitorPhysicalRectI32> {
        self.monitors
            .iter()
            .map(|m| MonitorPhysicalRectI32 {
                desktop: m.desktop_rect,
            })
            .collect()
    }
}

fn topology_fingerprint(monitors: &[MonitorTopology]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    for m in monitors {
        m.identifier.adapter_index.hash(&mut hasher);
        m.identifier.adapter_luid_high.hash(&mut hasher);
        m.identifier.adapter_luid_low.hash(&mut hasher);
        m.identifier.output_index.hash(&mut hasher);
        m.desktop_rect.left.hash(&mut hasher);
        m.desktop_rect.top.hash(&mut hasher);
        m.desktop_rect.right.hash(&mut hasher);
        m.desktop_rect.bottom.hash(&mut hasher);
        m.raster_width.hash(&mut hasher);
        m.raster_height.hash(&mut hasher);
        (m.rotation as u8).hash(&mut hasher);
        m.dpi_percent.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

/// Owned upright packed BGRA frame for one monitor.
#[derive(Clone, Debug)]
pub struct OwnedBgraFrame {
    pub buffer: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl OwnedBgraFrame {
    #[allow(dead_code)]
    pub fn byte_len(&self) -> usize {
        self.buffer.len()
    }

    pub fn validate(&self) -> Result<(), ScreenshotError> {
        let expected = (self.width as usize)
            .checked_mul(self.height as usize)
            .and_then(|p| p.checked_mul(4))
            .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
        if self.buffer.len() != expected {
            return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
        }
        Ok(())
    }
}

/// Optional system pointer metadata captured with the desktop.
#[derive(Clone, Debug)]
pub struct PointerSnapshot {
    #[allow(dead_code)]
    pub physical_position: PhysicalDesktopPointI32,
    #[allow(dead_code)]
    pub hotspot_x: u32,
    #[allow(dead_code)]
    pub hotspot_y: u32,
    #[allow(dead_code)]
    pub shape_bgra: Option<OwnedBgraFrame>,
}

/// Per-monitor frozen frame + topology metadata.
#[derive(Clone, Debug)]
pub struct MonitorSnapshot {
    /// 稳定显示器标识（DXGI 枚举用；universal 采集不读取）。
    #[allow(dead_code)]
    pub monitor_id: String,
    pub desktop_rect: PhysicalDesktopRectI32,
    #[allow(dead_code)]
    pub scale_factor: f64,
    #[allow(dead_code)]
    pub rotation: CaptureRotation,
    pub frame: OwnedBgraFrame,
}

/// Immutable multi-monitor desktop snapshot held by the session.
#[derive(Clone, Debug)]
pub struct DesktopSnapshot {
    #[allow(dead_code)]
    pub topology_fingerprint: String,
    #[allow(dead_code)]
    pub topology_generation: u64,
    #[allow(dead_code)]
    pub captured_at_ms: u64,
    pub monitors: Vec<MonitorSnapshot>,
    #[allow(dead_code)]
    pub pointer: Option<PointerSnapshot>,
}

impl DesktopSnapshot {
    /// Reserved: consumed by 07-22-screenshot-annotations-actions (annotation layer).
    #[allow(dead_code)]
    pub fn total_bgra_bytes(&self) -> u64 {
        self.monitors
            .iter()
            .map(|m| m.frame.byte_len() as u64)
            .sum()
    }
}

/// Capture options for a full-desktop freeze.
#[derive(Clone, Debug)]
pub struct CaptureOptions {
    pub timeout_ms: u32,
    #[allow(dead_code)]
    pub include_cursor: bool,
}

impl Default for CaptureOptions {
    fn default() -> Self {
        Self {
            timeout_ms: 1_000,
            include_cursor: false,
        }
    }
}

/// Platform-agnostic capture backend.
pub trait CaptureBackend: Send {
    /// 拓扑枚举（DXGI 后端内部校验用；universal 采集只走 `capture_all`）。
    #[allow(dead_code)]
    fn topology(&self) -> Result<DisplayTopology, ScreenshotError>;
    fn capture_all(&mut self, options: CaptureOptions) -> Result<DesktopSnapshot, ScreenshotError>;

    /// 采集指定物理桌面矩形内的区域（全屏读回后软件裁剪）。
    ///
    /// 默认实现返回 Unsupported，避免破坏现有实现。滚动截图用
    /// `capture_region_stream`（复用流更快）；本方法为单次采集，保留备用。
    #[allow(dead_code)]
    fn capture_region(
        &mut self,
        _rect: PhysicalDesktopRectI32,
    ) -> Result<OwnedBgraFrame, ScreenshotError> {
        Err(ScreenshotError::new(
            ScreenshotErrorCode::UnsupportedPlatform,
        ))
    }

    /// 流式区域采集：复用已打开的采集流，等待新内容并获取指定区域。
    ///
    /// 相比 `capture_region`（每次重建后端）快得多，适合滚动截图这类高频
    /// 连续采集场景。返回 `None` 表示等待超时（无新内容），调用方应跳过
    /// 本轮；`Some` 为最新帧的裁剪区域。
    fn capture_region_stream(
        &mut self,
        _rect: PhysicalDesktopRectI32,
    ) -> Result<Option<OwnedBgraFrame>, ScreenshotError> {
        Err(ScreenshotError::new(
            ScreenshotErrorCode::UnsupportedPlatform,
        ))
    }
}

/// Create the platform capture backend.
pub fn create_backend() -> Result<Box<dyn CaptureBackend>, ScreenshotError> {
    #[cfg(windows)]
    {
        windows_dxgi::create_backend()
    }
    #[cfg(not(windows))]
    {
        Err(ScreenshotError::new(
            ScreenshotErrorCode::UnsupportedPlatform,
        ))
    }
}

/// Copy BGRA rows from a pitched source into a packed buffer.
pub fn copy_bgra_with_pitch(
    source: &[u8],
    width: u32,
    height: u32,
    row_pitch: u32,
) -> Result<Vec<u8>, ScreenshotError> {
    let width_usize = width as usize;
    let height_usize = height as usize;
    let row_pitch_usize = row_pitch as usize;
    let row_bytes = width_usize
        .checked_mul(4)
        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
    if row_pitch_usize < row_bytes {
        return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
    }
    let required_source = row_pitch_usize
        .checked_mul(height_usize)
        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
    if source.len() < required_source {
        return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
    }
    let total_bytes = row_bytes
        .checked_mul(height_usize)
        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
    let mut owned = vec![0u8; total_bytes];
    for row in 0..height_usize {
        let src_offset = row
            .checked_mul(row_pitch_usize)
            .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
        let dst_offset = row
            .checked_mul(row_bytes)
            .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
        owned[dst_offset..dst_offset + row_bytes]
            .copy_from_slice(&source[src_offset..src_offset + row_bytes]);
    }
    Ok(owned)
}

/// 从 BGRA 帧中裁剪子区域（软件，逐行拷贝）。
///
/// `(x, y)` 是相对帧左上角的偏移；`(w, h)` 是裁剪尺寸。越界返回
/// `InvalidSelection`。
pub fn crop_bgra(
    frame: &OwnedBgraFrame,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<OwnedBgraFrame, ScreenshotError> {
    let fw = frame.width;
    let fh = frame.height;
    if x.checked_add(w).is_none_or(|right| right > fw)
        || y.checked_add(h).is_none_or(|bottom| bottom > fh)
        || w == 0
        || h == 0
    {
        return Err(ScreenshotError::new(ScreenshotErrorCode::InvalidSelection));
    }

    let row_bytes = usize::try_from(w)
        .ok()
        .and_then(|w| w.checked_mul(4))
        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
    let mut owned = vec![0u8; row_bytes * h as usize];
    for row in 0..h {
        let src_start = ((y + row) as usize * fw as usize + x as usize) * 4;
        let dst_start = row as usize * row_bytes;
        owned[dst_start..dst_start + row_bytes]
            .copy_from_slice(&frame.buffer[src_start..src_start + row_bytes]);
    }
    Ok(OwnedBgraFrame {
        buffer: owned,
        width: w,
        height: h,
    })
}

/// Normalize BGRA buffer so upright matches physical desktop orientation.
pub fn rotate_bgra_to_upright(
    source: Vec<u8>,
    width: u32,
    height: u32,
    rotation: CaptureRotation,
) -> Result<(Vec<u8>, u32, u32), ScreenshotError> {
    match rotation {
        CaptureRotation::Identity => Ok((source, width, height)),
        CaptureRotation::Unspecified => {
            Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged))
        }
        CaptureRotation::Rotate90 | CaptureRotation::Rotate180 | CaptureRotation::Rotate270 => {
            let source_width = usize::try_from(width)
                .map_err(|_| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            let source_height = usize::try_from(height)
                .map_err(|_| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            let expected = source_width
                .checked_mul(source_height)
                .and_then(|p| p.checked_mul(4))
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            if source.len() != expected {
                return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
            }
            let (target_width, target_height) = match rotation {
                CaptureRotation::Rotate180 => (source_width, source_height),
                CaptureRotation::Rotate90 | CaptureRotation::Rotate270 => {
                    (source_height, source_width)
                }
                CaptureRotation::Identity | CaptureRotation::Unspecified => unreachable!(),
            };
            let mut target = vec![0u8; expected];
            for source_y in 0..source_height {
                for source_x in 0..source_width {
                    let (target_x, target_y) = match rotation {
                        CaptureRotation::Rotate90 => (source_height - 1 - source_y, source_x),
                        CaptureRotation::Rotate180 => {
                            (source_width - 1 - source_x, source_height - 1 - source_y)
                        }
                        CaptureRotation::Rotate270 => (source_y, source_width - 1 - source_x),
                        CaptureRotation::Identity | CaptureRotation::Unspecified => unreachable!(),
                    };
                    let source_offset = (source_y * source_width + source_x) * 4;
                    let target_offset = (target_y * target_width + target_x) * 4;
                    target[target_offset..target_offset + 4]
                        .copy_from_slice(&source[source_offset..source_offset + 4]);
                }
            }
            Ok((
                target,
                u32::try_from(target_width)
                    .map_err(|_| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?,
                u32::try_from(target_height)
                    .map_err(|_| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_bgra_with_pitch_strips_padding() {
        let source: Vec<u8> = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0xAA, 0xBB, 0xCC, 0xDD, 0x00, 0x00,
            0x00, 0x00, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0xEE, 0xFF, 0x00, 0x11,
            0x00, 0x00, 0x00, 0x00,
        ]
        .to_vec();
        let packed = copy_bgra_with_pitch(&source, 2, 2, 16).expect("copy");
        assert_eq!(packed.len(), 16);
        assert_eq!(
            &packed[0..8],
            &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
        );
        assert_eq!(
            &packed[8..16],
            &[0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18]
        );
    }

    #[test]
    fn crop_bgra_extracts_subregion() {
        // 2x2 帧：A B / C D（BGRA 红）。
        let mut frame = OwnedBgraFrame {
            buffer: vec![0u8; 2 * 2 * 4],
            width: 2,
            height: 2,
        };
        frame.buffer[0..4].copy_from_slice(&[1, 0, 0, 255]); // A
        frame.buffer[4..8].copy_from_slice(&[2, 0, 0, 255]); // B
        frame.buffer[8..12].copy_from_slice(&[3, 0, 0, 255]); // C
        frame.buffer[12..16].copy_from_slice(&[4, 0, 0, 255]); // D

        let cropped = crop_bgra(&frame, 1, 0, 1, 1).expect("crop");
        assert_eq!((cropped.width, cropped.height), (1, 1));
        assert_eq!(&cropped.buffer[0..4], &[2, 0, 0, 255]); // B

        let lower = crop_bgra(&frame, 0, 1, 2, 1).expect("crop");
        assert_eq!((lower.width, lower.height), (2, 1));
        assert_eq!(&lower.buffer[0..4], &[3, 0, 0, 255]); // C
        assert_eq!(&lower.buffer[4..8], &[4, 0, 0, 255]); // D
    }

    #[test]
    fn crop_bgra_rejects_out_of_bounds() {
        let frame = OwnedBgraFrame {
            buffer: vec![0u8; 4 * 4 * 4],
            width: 4,
            height: 4,
        };
        assert!(crop_bgra(&frame, 3, 0, 2, 1).is_err()); // 右越界
        assert!(crop_bgra(&frame, 0, 3, 1, 2).is_err()); // 下越界
        assert!(crop_bgra(&frame, 0, 0, 0, 1).is_err()); // 宽为 0
    }

    #[test]
    fn rotate_180_swaps_corners() {
        // 2x2: pixels A B / C D
        let mut source = vec![0u8; 2 * 2 * 4];
        source[0..4].copy_from_slice(&[1, 0, 0, 255]); // A
        source[4..8].copy_from_slice(&[2, 0, 0, 255]); // B
        source[8..12].copy_from_slice(&[3, 0, 0, 255]); // C
        source[12..16].copy_from_slice(&[4, 0, 0, 255]); // D
        let (out, w, h) =
            rotate_bgra_to_upright(source, 2, 2, CaptureRotation::Rotate180).expect("rot");
        assert_eq!((w, h), (2, 2));
        assert_eq!(&out[0..4], &[4, 0, 0, 255]); // D
        assert_eq!(&out[12..16], &[1, 0, 0, 255]); // A
    }

    #[test]
    fn topology_fingerprint_stable_for_same_layout() {
        let m = MonitorTopology {
            id: "m0".into(),
            identifier: OutputIdentifier {
                adapter_index: 0,
                adapter_luid_high: 1,
                adapter_luid_low: 2,
                output_index: 0,
            },
            desktop_rect: PhysicalDesktopRectI32::new(0, 0, 100, 100).unwrap(),
            rotation: CaptureRotation::Identity,
            raster_width: 100,
            raster_height: 100,
            dpi_percent: Some(100),
        };
        let t1 = DisplayTopology::new(vec![m.clone()]);
        let t2 = DisplayTopology::new(vec![m]);
        assert_eq!(t1.fingerprint, t2.fingerprint);
    }
}
