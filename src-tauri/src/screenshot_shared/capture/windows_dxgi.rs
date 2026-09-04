//! Windows DXGI Desktop Duplication capture backend.
//!
//! On non-Windows platforms this module provides a stub that returns
//! `unsupported_platform`.

use crate::screenshot_shared::capture::{
    CaptureBackend, CaptureOptions, CaptureRotation, DesktopSnapshot, DisplayTopology,
    MonitorSnapshot, MonitorTopology, OutputIdentifier, OwnedBgraFrame,
};
use crate::screenshot_shared::types::{PhysicalDesktopRectI32, ScreenshotError, ScreenshotErrorCode};

/// Create the platform backend.
pub fn create_backend() -> Result<Box<dyn CaptureBackend>, ScreenshotError> {
    #[cfg(windows)]
    {
        Ok(Box::new(win::WindowsDxgiBackend::new()))
    }
    #[cfg(not(windows))]
    {
        Ok(Box::new(UnsupportedBackend))
    }
}

#[allow(dead_code)]
struct UnsupportedBackend;

#[allow(dead_code)]
impl CaptureBackend for UnsupportedBackend {
    fn topology(&self) -> Result<DisplayTopology, ScreenshotError> {
        Err(ScreenshotError::new(
            ScreenshotErrorCode::UnsupportedPlatform,
        ))
    }

    fn capture_all(
        &mut self,
        _options: CaptureOptions,
    ) -> Result<DesktopSnapshot, ScreenshotError> {
        Err(ScreenshotError::new(
            ScreenshotErrorCode::UnsupportedPlatform,
        ))
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::screenshot_shared::capture::{copy_bgra_with_pitch, rotate_bgra_to_upright};
    use windows::core::Interface;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_ROTATE180,
        DXGI_MODE_ROTATION_ROTATE270, DXGI_MODE_ROTATION_ROTATE90, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
        IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_DEVICE_HUNG,
        DXGI_ERROR_DEVICE_REMOVED, DXGI_ERROR_DEVICE_RESET, DXGI_ERROR_NOT_FOUND,
        DXGI_ERROR_WAIT_TIMEOUT,
    };

    pub(super) struct WindowsDxgiBackend {
        topology_generation: u64,
        /// 流式采集持有的打开流（滚动截图高频采集复用，避免每次重建后端）。
        stream: Option<DxgiCapture>,
    }

    impl WindowsDxgiBackend {
        pub(super) fn new() -> Self {
            Self {
                topology_generation: 1,
                stream: None,
            }
        }
    }

    impl CaptureBackend for WindowsDxgiBackend {
        fn topology(&self) -> Result<DisplayTopology, ScreenshotError> {
            enumerate_topology()
        }

        fn capture_all(
            &mut self,
            options: CaptureOptions,
        ) -> Result<DesktopSnapshot, ScreenshotError> {
            let expected = enumerate_topology()?;
            let mut capture = DxgiCapture::open(&expected)?;
            let snapshot = capture.capture_all(options.timeout_ms, self.topology_generation)?;
            // Re-check topology after capture.
            let after = enumerate_topology()?;
            if after.fingerprint != expected.fingerprint {
                return Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged));
            }
            self.topology_generation = self.topology_generation.saturating_add(1);
            Ok(snapshot)
        }

        fn capture_region(
            &mut self,
            rect: PhysicalDesktopRectI32,
        ) -> Result<OwnedBgraFrame, ScreenshotError> {
            let expected = enumerate_topology()?;
            let mut capture = DxgiCapture::open(&expected)?;
            let snapshot = capture.capture_all(1_000, self.topology_generation)?;
            let after = enumerate_topology()?;
            if after.fingerprint != expected.fingerprint {
                return Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged));
            }
            self.topology_generation = self.topology_generation.saturating_add(1);

            // 找到包含 rect 的显示器。
            let monitor = snapshot
                .monitors
                .iter()
                .find(|m| {
                    let d = m.desktop_rect;
                    rect.left >= d.left
                        && rect.top >= d.top
                        && rect.right <= d.right
                        && rect.bottom <= d.bottom
                })
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;

            let x = (rect.left - monitor.desktop_rect.left) as u32;
            let y = (rect.top - monitor.desktop_rect.top) as u32;
            let w = rect
                .width()
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;
            let h = rect
                .height()
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;
            crate::screenshot_shared::capture::crop_bgra(&monitor.frame, x, y, w, h)
        }

        fn capture_region_stream(
            &mut self,
            rect: PhysicalDesktopRectI32,
        ) -> Result<Option<OwnedBgraFrame>, ScreenshotError> {
            // 复用已打开的流：拓扑指纹匹配则直接采集，否则重建。
            let expected = enumerate_topology()?;
            let needs_reopen = match &self.stream {
                Some(cap) => cap.topology.fingerprint != expected.fingerprint,
                None => true,
            };
            if needs_reopen {
                self.stream = Some(DxgiCapture::open(&expected)?);
            }
            let capture = self.stream.as_mut().ok_or_else(|| {
                ScreenshotError::new(ScreenshotErrorCode::CaptureFailed)
            })?;

            // 找到包含 rect 的显示器。
            let stream = capture
                .streams
                .iter()
                .find(|s| {
                    let d = s.monitor.desktop_rect;
                    rect.left >= d.left
                        && rect.top >= d.top
                        && rect.right <= d.right
                        && rect.bottom <= d.bottom
                })
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;

            // 获取最新帧：短阻塞（16ms）等新内容。拿到用最新帧；
            // 无新帧返回 None（调用方跳过本轮，不返回旧缓存避免 diff=0 假象）。
            match stream.capture_one_wait(16)? {
                Some(frame) => {
                    let x = (rect.left - stream.monitor.desktop_rect.left) as u32;
                    let y = (rect.top - stream.monitor.desktop_rect.top) as u32;
                    let w = rect
                        .width()
                        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;
                    let h = rect
                        .height()
                        .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::InvalidSelection))?;
                    let cropped = crate::screenshot_shared::capture::crop_bgra(&frame, x, y, w, h)?;
                    Ok(Some(cropped))
                }
                None => Ok(None),
            }
        }
    }

    fn classify_error(error: windows::core::Error) -> ScreenshotError {
        let code = match error.code() {
            c if c == DXGI_ERROR_WAIT_TIMEOUT => ScreenshotErrorCode::AcquireTimeout,
            c if c == DXGI_ERROR_ACCESS_LOST => ScreenshotErrorCode::AccessLost,
            c if c == DXGI_ERROR_DEVICE_REMOVED
                || c == DXGI_ERROR_DEVICE_RESET
                || c == DXGI_ERROR_DEVICE_HUNG =>
            {
                ScreenshotErrorCode::DeviceLost
            }
            _ => ScreenshotErrorCode::CaptureFailed,
        };
        ScreenshotError::new(code)
    }

    struct FrameLease<'a> {
        duplication: &'a IDXGIOutputDuplication,
        acquired: bool,
    }

    impl<'a> FrameLease<'a> {
        fn new(duplication: &'a IDXGIOutputDuplication) -> Self {
            Self {
                duplication,
                acquired: true,
            }
        }

        fn release(mut self) -> Result<(), ScreenshotError> {
            self.acquired = false;
            unsafe { self.duplication.ReleaseFrame() }.map_err(classify_error)
        }
    }

    impl Drop for FrameLease<'_> {
        fn drop(&mut self) {
            if self.acquired {
                let _ = unsafe { self.duplication.ReleaseFrame() };
            }
        }
    }

    struct MappedSurface<'a> {
        context: &'a ID3D11DeviceContext,
        texture: &'a ID3D11Texture2D,
        mapped: bool,
    }

    impl Drop for MappedSurface<'_> {
        fn drop(&mut self) {
            if self.mapped {
                unsafe { self.context.Unmap(self.texture, 0) };
            }
        }
    }

    struct OutputStream {
        monitor: MonitorTopology,
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        duplication: IDXGIOutputDuplication,
    }

    struct DxgiCapture {
        topology: DisplayTopology,
        streams: Vec<OutputStream>,
    }

    impl DxgiCapture {
        fn open(expected: &DisplayTopology) -> Result<Self, ScreenshotError> {
            let factory =
                unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }.map_err(classify_error)?;
            let mut streams = Vec::new();

            for adapter_index in 0u32.. {
                let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
                    Ok(adapter) => adapter,
                    Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                    Err(error) => return Err(classify_error(error)),
                };
                let adapter_desc = unsafe { adapter.GetDesc() }.map_err(classify_error)?;
                let (device, context) = create_device(&adapter)?;

                for output_index in 0u32.. {
                    let output = match unsafe { adapter.EnumOutputs(output_index) } {
                        Ok(output) => output,
                        Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                        Err(error) => return Err(classify_error(error)),
                    };
                    let output_desc = unsafe { output.GetDesc() }.map_err(classify_error)?;
                    if !output_desc.AttachedToDesktop.as_bool() {
                        continue;
                    }
                    let monitor = monitor_topology(
                        adapter_index,
                        output_index,
                        adapter_desc.AdapterLuid.HighPart,
                        adapter_desc.AdapterLuid.LowPart,
                        &output_desc,
                    )?;
                    let output1 = output.cast::<IDXGIOutput1>().map_err(classify_error)?;
                    let duplication =
                        unsafe { output1.DuplicateOutput(&device) }.map_err(classify_error)?;
                    streams.push(OutputStream {
                        monitor,
                        device: device.clone(),
                        context: context.clone(),
                        duplication,
                    });
                }
            }

            if streams.is_empty() {
                return Err(ScreenshotError::new(ScreenshotErrorCode::NoOutputs));
            }

            let topology =
                DisplayTopology::new(streams.iter().map(|s| s.monitor.clone()).collect());
            if topology.fingerprint != expected.fingerprint {
                return Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged));
            }
            Ok(Self { topology, streams })
        }

        fn capture_all(
            &mut self,
            timeout_ms: u32,
            topology_generation: u64,
        ) -> Result<DesktopSnapshot, ScreenshotError> {
            // Drain a few stale frames per stream first.
            for stream in &self.streams {
                for _ in 0..8 {
                    if !stream.drain_one()? {
                        break;
                    }
                }
            }

            let mut monitors = Vec::with_capacity(self.streams.len());
            for stream in &self.streams {
                let frame = stream.capture_one(timeout_ms)?;
                let scale = stream
                    .monitor
                    .dpi_percent
                    .map(|p| f64::from(p) / 100.0)
                    .unwrap_or(1.0);
                monitors.push(MonitorSnapshot {
                    monitor_id: stream.monitor.id.clone(),
                    desktop_rect: stream.monitor.desktop_rect,
                    scale_factor: scale,
                    rotation: CaptureRotation::Identity, // already upright
                    frame,
                });
            }

            let captured_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            Ok(DesktopSnapshot {
                topology_fingerprint: self.topology.fingerprint.clone(),
                topology_generation,
                captured_at_ms,
                monitors,
                pointer: None,
            })
        }
    }

    impl OutputStream {
        /// 等待并获取一帧。桌面短暂静止（无新帧）时 WAIT_TIMEOUT 是暂时状态，
        /// 重试 `retries` 次再放弃，避免截图误报「截屏超时」。
        fn capture_one(&self, timeout_ms: u32) -> Result<OwnedBgraFrame, ScreenshotError> {
            const RETRIES: u32 = 4;
            let mut last_err = None;
            for _ in 0..RETRIES {
                match self.capture_one_attempt(timeout_ms) {
                    Ok(frame) => return Ok(frame),
                    Err(e) if e.code == ScreenshotErrorCode::AcquireTimeout => {
                        last_err = Some(e);
                        // 短暂等待后重试（下一轮 AcquireNextFrame 会等新帧）。
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(e) => return Err(e),
                }
            }
            Err(last_err.unwrap_or_else(|| {
                ScreenshotError::new(ScreenshotErrorCode::AcquireTimeout)
            }))
        }

        fn capture_one_attempt(
            &self,
            timeout_ms: u32,
        ) -> Result<OwnedBgraFrame, ScreenshotError> {
            let mut frame_info = Default::default();
            let mut desktop_resource = None;
            unsafe {
                self.duplication.AcquireNextFrame(
                    timeout_ms,
                    &mut frame_info,
                    &mut desktop_resource,
                )
            }
            .map_err(classify_error)?;
            let lease = FrameLease::new(&self.duplication);

            let desktop_resource = desktop_resource
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            let texture = desktop_resource
                .cast::<ID3D11Texture2D>()
                .map_err(classify_error)?;
            let mut texture_desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut texture_desc) };
            if texture_desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
                || texture_desc.SampleDesc.Count != 1
            {
                return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
            }

            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: texture_desc.Width,
                Height: texture_desc.Height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging = None;
            unsafe {
                self.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))
            }
            .map_err(classify_error)?;
            let staging =
                staging.ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;

            unsafe { self.context.CopyResource(&staging, &texture) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe {
                self.context
                    .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            }
            .map_err(classify_error)?;
            let mapped_surface = MappedSurface {
                context: &self.context,
                texture: &staging,
                mapped: true,
            };

            let width = texture_desc.Width;
            let height = texture_desc.Height;
            let row_pitch = mapped.RowPitch;
            let source_pitch = row_pitch as usize;
            let source_len = source_pitch
                .checked_mul(height as usize)
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            if mapped.pData.is_null() {
                return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
            }
            let source =
                unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), source_len) };
            let packed = copy_bgra_with_pitch(source, width, height, row_pitch)?;
            drop(mapped_surface);
            lease.release()?;

            let (upright, upright_w, upright_h) =
                rotate_bgra_to_upright(packed, width, height, self.monitor.rotation)?;
            if upright_w != self.monitor.raster_width || upright_h != self.monitor.raster_height {
                return Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged));
            }

            let frame = OwnedBgraFrame {
                buffer: upright,
                width: upright_w,
                height: upright_h,
            };
            frame.validate()?;
            Ok(frame)
        }

        fn drain_one(&self) -> Result<bool, ScreenshotError> {
            let mut frame_info = Default::default();
            let mut desktop_resource = None;
            match unsafe {
                self.duplication
                    .AcquireNextFrame(0, &mut frame_info, &mut desktop_resource)
            } {
                Ok(()) => {
                    let lease = FrameLease::new(&self.duplication);
                    lease.release()?;
                    Ok(true)
                }
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => Ok(false),
                Err(error) => Err(classify_error(error)),
            }
        }
    }

    impl OutputStream {
        /// 等待新内容并获取最新帧。
        ///
        /// `AcquireNextFrame(timeout_ms)`：等待最多 `timeout_ms` 毫秒的新
        /// 内容；超时返回 `None`（WAIT_TIMEOUT，非错误）。检查
        /// `DXGI_OUTDUPL_FRAME_INFO` 的 `TotalMetadataBufferSize`：为 0 表示
        /// 桌面位图没变（可能只是鼠标指针动了），同样返回 `None`。
        fn capture_one_wait(&self, timeout_ms: u32) -> Result<Option<OwnedBgraFrame>, ScreenshotError> {
            let mut frame_info = Default::default();
            let mut desktop_resource = None;
            match unsafe {
                self.duplication
                    .AcquireNextFrame(timeout_ms, &mut frame_info, &mut desktop_resource)
            } {
                Ok(()) => {}
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                Err(error) => return Err(classify_error(error)),
            }
            let lease = FrameLease::new(&self.duplication);

            // 桌面位图未变化（仅指针移动/形状变化）→ 无新内容。
            if frame_info.TotalMetadataBufferSize == 0 {
                let _ = lease.release();
                return Ok(None);
            }

            let desktop_resource = desktop_resource
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            let texture = desktop_resource
                .cast::<ID3D11Texture2D>()
                .map_err(classify_error)?;
            let mut texture_desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut texture_desc) };
            if texture_desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
                || texture_desc.SampleDesc.Count != 1
            {
                return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
            }

            let staging_desc = D3D11_TEXTURE2D_DESC {
                Width: texture_desc.Width,
                Height: texture_desc.Height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging = None;
            unsafe {
                self.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))
            }
            .map_err(classify_error)?;
            let staging =
                staging.ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;

            unsafe { self.context.CopyResource(&staging, &texture) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe {
                self.context
                    .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            }
            .map_err(classify_error)?;
            let mapped_surface = MappedSurface {
                context: &self.context,
                texture: &staging,
                mapped: true,
            };

            let width = texture_desc.Width;
            let height = texture_desc.Height;
            let row_pitch = mapped.RowPitch;
            let source_pitch = row_pitch as usize;
            let source_len = source_pitch
                .checked_mul(height as usize)
                .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
            if mapped.pData.is_null() {
                return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
            }
            let source =
                unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), source_len) };
            let packed = copy_bgra_with_pitch(source, width, height, row_pitch)?;
            drop(mapped_surface);
            lease.release()?;

            let (upright, upright_w, upright_h) =
                rotate_bgra_to_upright(packed, width, height, self.monitor.rotation)?;
            if upright_w != self.monitor.raster_width || upright_h != self.monitor.raster_height {
                return Err(ScreenshotError::new(ScreenshotErrorCode::TopologyChanged));
            }

            let frame = OwnedBgraFrame {
                buffer: upright,
                width: upright_w,
                height: upright_h,
            };
            frame.validate()?;
            Ok(Some(frame))
        }
    }

    fn create_device(
        adapter: &IDXGIAdapter1,
    ) -> Result<(ID3D11Device, ID3D11DeviceContext), ScreenshotError> {
        let base_adapter = adapter.cast::<IDXGIAdapter>().map_err(classify_error)?;
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                Some(&base_adapter),
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        }
        .map_err(classify_error)?;
        Ok((
            device.ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::DeviceLost))?,
            context.ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::DeviceLost))?,
        ))
    }

    pub(super) fn enumerate_topology() -> Result<DisplayTopology, ScreenshotError> {
        let factory = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }.map_err(classify_error)?;
        let mut monitors = Vec::new();

        for adapter_index in 0u32.. {
            let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
                Ok(adapter) => adapter,
                Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(error) => return Err(classify_error(error)),
            };
            let adapter_desc = unsafe { adapter.GetDesc() }.map_err(classify_error)?;
            for output_index in 0u32.. {
                let output = match unsafe { adapter.EnumOutputs(output_index) } {
                    Ok(output) => output,
                    Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                    Err(error) => return Err(classify_error(error)),
                };
                let output_desc = unsafe { output.GetDesc() }.map_err(classify_error)?;
                if !output_desc.AttachedToDesktop.as_bool() {
                    continue;
                }
                monitors.push(monitor_topology(
                    adapter_index,
                    output_index,
                    adapter_desc.AdapterLuid.HighPart,
                    adapter_desc.AdapterLuid.LowPart,
                    &output_desc,
                )?);
            }
        }

        if monitors.is_empty() {
            return Err(ScreenshotError::new(ScreenshotErrorCode::NoOutputs));
        }
        Ok(DisplayTopology::new(monitors))
    }

    fn monitor_topology(
        adapter_index: u32,
        output_index: u32,
        adapter_luid_high: i32,
        adapter_luid_low: u32,
        output_desc: &windows::Win32::Graphics::Dxgi::DXGI_OUTPUT_DESC,
    ) -> Result<MonitorTopology, ScreenshotError> {
        let desktop_rect = PhysicalDesktopRectI32 {
            left: output_desc.DesktopCoordinates.left,
            top: output_desc.DesktopCoordinates.top,
            right: output_desc.DesktopCoordinates.right,
            bottom: output_desc.DesktopCoordinates.bottom,
        };
        if !desktop_rect.is_valid() {
            return Err(ScreenshotError::new(ScreenshotErrorCode::CaptureFailed));
        }
        let raster_width = desktop_rect
            .width()
            .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;
        let raster_height = desktop_rect
            .height()
            .ok_or_else(|| ScreenshotError::new(ScreenshotErrorCode::CaptureFailed))?;

        Ok(MonitorTopology {
            id: format!("a{adapter_index}-o{output_index}"),
            identifier: OutputIdentifier {
                adapter_index,
                adapter_luid_high,
                adapter_luid_low,
                output_index,
            },
            desktop_rect,
            rotation: rotation_from_dxgi(output_desc.Rotation),
            raster_width,
            raster_height,
            // DPI is not available from DXGI alone; leave None (scale defaults to 1.0).
            dpi_percent: None,
        })
    }

    fn rotation_from_dxgi(
        rotation: windows::Win32::Graphics::Dxgi::Common::DXGI_MODE_ROTATION,
    ) -> CaptureRotation {
        match rotation {
            v if v == DXGI_MODE_ROTATION_IDENTITY => CaptureRotation::Identity,
            v if v == DXGI_MODE_ROTATION_ROTATE90 => CaptureRotation::Rotate90,
            v if v == DXGI_MODE_ROTATION_ROTATE180 => CaptureRotation::Rotate180,
            v if v == DXGI_MODE_ROTATION_ROTATE270 => CaptureRotation::Rotate270,
            _ => CaptureRotation::Unspecified,
        }
    }
}
