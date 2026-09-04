//! 截图历史：缩略图生成与读取命令。

use std::io::Cursor;

use tauri::State;

use super::*;

/// 生成固定尺寸上限的 PNG 缩略图（长边不超过 192x128，不放大）。
fn create_thumbnail_png(png: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|error| format!("缩略图解码失败：{error}"))?;
    let thumbnail = if image.width() > 192 || image.height() > 128 {
        image.thumbnail(192, 128)
    } else {
        image
    };
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("缩略图编码失败：{error}"))?;
    Ok(output.into_inner())
}

/// Returns a compact final-image thumbnail for history list navigation.
/// The dimensions are fixed server-side so callers cannot request unbounded
/// image processing work or accidentally load every full-resolution PNG.
#[tauri::command]
#[specta::specta]
pub fn history_read_thumbnail(
    history: State<'_, HistoryRuntime>,
    record_id: String,
) -> Result<Vec<u8>, AppError> {
    validate_opaque_id(&record_id, "record")?;
    let png = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .read_image(&record_id, ImageVariant::Final)?;
    create_thumbnail_png(&png).map_err(AppError::Message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32, color: [u8; 4]) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba(color));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        bytes
    }

    #[test]
    fn thumbnail_png_limits_dimensions_and_preserves_aspect_ratio() {
        let source = png(640, 320, [20, 40, 60, 255]);
        let bytes = create_thumbnail_png(&source).expect("thumbnail");
        let thumbnail = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .expect("thumbnail png");
        assert_eq!((thumbnail.width(), thumbnail.height()), (192, 96));
        assert!(bytes.len() < source.len());
    }

    #[test]
    fn thumbnail_png_does_not_upscale_small_images() {
        let source = png(40, 20, [20, 40, 60, 255]);
        let bytes = create_thumbnail_png(&source).expect("thumbnail");
        let thumbnail = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .expect("thumbnail png");
        assert_eq!((thumbnail.width(), thumbnail.height()), (40, 20));
    }
}
