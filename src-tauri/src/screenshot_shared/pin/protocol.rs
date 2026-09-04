//! 贴图图片 URI scheme 协议（`pin-image://`）。
//!
//! 贴图窗口通过 `pin-image://<pin_id>/<image_token>` 加载 PNG；`image_token` 为
//! 不透明令牌，防未授权读取。协议响应只读 `PIN_REGISTRY`，不初始化注册表。

use http::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Request, Response, StatusCode,
};
use tauri::Runtime;

use super::registry::PIN_REGISTRY;
use super::validate_pin_id;

const PIN_IMAGE_SCHEME: &str = "pin-image";

pub fn register_image_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol(PIN_IMAGE_SCHEME, |_app, request| {
        image_protocol_response(&request)
    })
}

fn image_protocol_response(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // 由前置校验保证（内部不变量）：status 恒被设为合法常量、header 值为静态 ASCII、
    // body 为 Vec<u8>；http crate 仅在未设 status 时让 body() 返回 Err，此处不可能，故 unwrap。
    let response = |status| {
        Response::builder()
            .status(status)
            .header(CACHE_CONTROL, "no-store")
    };
    let mut path_segments = request.uri().path().trim_start_matches('/').split('/');
    let Some(pin_id) = path_segments.next() else {
        return response(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap();
    };
    let Some(image_token) = path_segments.next() else {
        return response(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap();
    };
    if path_segments.next().is_some()
        || validate_pin_id(pin_id).is_err()
        || validate_pin_id(image_token).is_err()
    {
        return response(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap();
    }

    let Some(registry) = PIN_REGISTRY.get() else {
        return response(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    };
    match registry.image(pin_id, image_token) {
        Ok(image_png) => response(StatusCode::OK)
            .header(CONTENT_TYPE, "image/png")
            .body(image_png)
            .unwrap(),
        Err(_) => response(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn pin_image_protocol_requires_matching_opaque_ids() {
        let pin_id = Uuid::new_v4().to_string();
        let image_token = Uuid::new_v4().to_string();
        let valid = Request::builder()
            .uri(format!(
                "https://{PIN_IMAGE_SCHEME}.localhost/{pin_id}/{image_token}"
            ))
            .body(Vec::new())
            .unwrap();
        let malformed = Request::builder()
            .uri(format!(
                "https://{PIN_IMAGE_SCHEME}.localhost/not-a-uuid/{image_token}"
            ))
            .body(Vec::new())
            .unwrap();

        assert_eq!(
            image_protocol_response(&valid).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            image_protocol_response(&malformed).status(),
            StatusCode::BAD_REQUEST
        );
    }
}
