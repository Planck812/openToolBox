use super::*;

pub(super) fn platform_info() -> Result<EnvPlatformInfo, EnvCommandError> {
    unsupported()
}

pub(super) fn list() -> Result<ListEnvResult, EnvCommandError> {
    unsupported()
}

pub(super) fn get(_key: String) -> Result<GetEnvResult, EnvCommandError> {
    unsupported()
}

pub(super) fn preview(
    _state: &EnvPreviewState,
    _request: PreviewEnvWriteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    unsupported()
}

pub(super) fn preview_delete(
    _state: &EnvPreviewState,
    _request: PreviewEnvDeleteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    unsupported()
}

pub(super) fn apply(
    _state: &EnvPreviewState,
    _request: ApplyEnvWriteRequest,
) -> Result<SetEnvResult, EnvCommandError> {
    unsupported()
}
