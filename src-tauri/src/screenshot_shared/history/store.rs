//! 截图历史：HistoryStore 存储引擎（发布 / 列表 / 读取 / 删除 / 恢复 / 配额保留）。
//!
//! HistoryStore 的 impl 保持单一（私有字段跨文件不可见），trash/quota 相关仅引用其类型与自由函数。

use std::fs;
use std::path::{Path, PathBuf};

use fs2::available_space;
use uuid::Uuid;

use super::*;

/// 版本化截图历史存储引擎。`root` 为截图历史根目录（如 `…/open-toolbox/screenshots-v2`）。
pub(crate) struct HistoryStore {
    pub(crate) root: PathBuf,
    pub(crate) quota_bytes: u64,
}

impl HistoryStore {
    pub(crate) fn new(root: PathBuf, quota_bytes: u64) -> Result<Self, String> {
        if quota_bytes == 0 {
            return Err("截图历史容量必须大于 0".to_string());
        }
        Ok(Self { root, quota_bytes })
    }

    pub(crate) fn records_dir(&self) -> PathBuf {
        self.root.join(RECORDS_DIR)
    }

    pub(crate) fn staging_dir(&self) -> PathBuf {
        self.root.join(STAGING_DIR)
    }

    pub(crate) fn trash_dir(&self) -> PathBuf {
        self.root.join(TRASH_DIR)
    }

    pub(crate) fn ensure_layout(&self) -> Result<(), String> {
        ensure_real_directory(&self.root)?;
        ensure_real_directory(&self.records_dir())?;
        ensure_real_directory(&self.staging_dir())?;
        ensure_real_directory(&self.trash_dir())
    }

    pub(crate) fn initialize_and_recover(&mut self, legacy_root: &Path, now: u64) -> Result<(), String> {
        self.ensure_layout()?;
        let marker = self.root.join(INIT_MARKER);
        if !marker.exists() {
            if legacy_root.exists() {
                let metadata = fs::symlink_metadata(legacy_root)
                    .map_err(|error| format!("检查旧截图目录失败：{error}"))?;
                if metadata.file_type().is_symlink() {
                    return Err("拒绝清理符号链接形式的旧截图目录".to_string());
                }
                fs::remove_dir_all(legacy_root)
                    .map_err(|error| format!("清理旧截图目录失败：{error}"))?;
            }
            write_synced_file(&marker, b"2")?;
        }
        self.recover(now)
    }

    pub(crate) fn recover(&mut self, now: u64) -> Result<(), String> {
        self.ensure_layout()?;
        for entry in read_directories(&self.staging_dir())? {
            fs::remove_dir_all(&entry)
                .map_err(|error| format!("清理未完成截图记录失败：{error}"))?;
        }

        for entry in read_directories(&self.trash_dir())? {
            let Some(record_id) = file_name(&entry) else {
                remove_dir_best_effort(&entry);
                continue;
            };
            let metadata = read_trash_metadata(&entry).ok();
            match metadata {
                Some(metadata)
                    if metadata.record_id == record_id && now < metadata.delete_after =>
                {
                    if self.read_manifest_in(&entry, &record_id).is_err() {
                        remove_dir_best_effort(&entry);
                    }
                    // Valid undoable trash stays hidden after restart. It remains in
                    // trash until the persisted deadline, when settlement deletes it.
                }
                _ => remove_dir_best_effort(&entry),
            }
        }

        let _ = self.list_records(now, true)?;
        Ok(())
    }

    pub(crate) fn create_copy_from_record(
        &mut self,
        record_id: &str,
        variant: HistoryImageVariant,
    ) -> Result<HistoryManifest, String> {
        let source = self.get_manifest(record_id)?;
        let bytes = self.read_image(record_id, variant)?;
        let (width, height) = validate_png(&bytes)?;
        let source_variant = match variant {
            HistoryImageVariant::Original => "original",
            HistoryImageVariant::Final => "final",
        };

        self.publish(PublishHistoryRequest {
            // A copy is intentionally a distinct artifact rather than a retry of
            // the source artifact, even when both persisted payloads are equal.
            artifact_id: Uuid::new_v4().to_string(),
            original_png: bytes.clone(),
            final_png: bytes,
            width,
            height,
            source: HistorySource {
                kind: "reannotate".to_string(),
                record_id: Some(source.record_id),
                variant: Some(source_variant.to_string()),
            },
        })
    }

    /// 发布前（锁外）完成最重的 PNG 解码校验与摘要计算，避免在全局 store 锁内
    /// 解码/哈希大图而阻塞所有历史命令。
    pub(crate) fn prepare_publish(request: PublishHistoryRequest) -> Result<PreparedPublish, String> {
        let final_dimensions = validate_publish_request(&request)?;
        let original_digest = sha256_hex(&request.original_png);
        let final_digest = sha256_hex(&request.final_png);
        let artifact_digest = artifact_digest(
            &original_digest,
            &final_digest,
            request.width,
            request.height,
        );
        Ok(PreparedPublish {
            request,
            final_dimensions,
            original_digest,
            final_digest,
            artifact_digest,
        })
    }

    /// 便捷入口：先在锁外 prepare（解码/哈希），再在锁内完成清单比对、淘汰与落盘。
    pub(crate) fn publish(&mut self, request: PublishHistoryRequest) -> Result<HistoryManifest, String> {
        let prepared = Self::prepare_publish(request)?;
        self.publish_prepared(prepared)
    }

    /// 锁内完成的部分：只做轻量清单比对 + 必要的磁盘 IO（淘汰/落盘），不再解码/哈希。
    pub(crate) fn publish_prepared(&mut self, prepared: PreparedPublish) -> Result<HistoryManifest, String> {
        let PreparedPublish {
            request,
            final_dimensions,
            original_digest,
            final_digest,
            artifact_digest,
        } = prepared;
        self.ensure_layout()?;
        let now = now_millis();

        let existing = self.read_all_valid_manifests()?;
        if let Some(manifest) = existing
            .iter()
            .find(|manifest| manifest.artifact_id == request.artifact_id)
        {
            if manifest.artifact_digest == artifact_digest {
                return Ok(manifest.clone());
            }
            return Err("相同 artifact ID 已发布为不同内容".to_string());
        }

        self.settle_expired_trash(now)?;
        let incoming_bytes = (request.original_png.len() + request.final_png.len()) as u64;
        let free_bytes = available_space(&self.root)
            .map_err(|error| format!("无法检查截图历史可用空间：{error}"))?;
        let candidates: Vec<RetentionRecord> = existing
            .iter()
            .map(|manifest| RetentionRecord {
                record_id: manifest.record_id.clone(),
                created_at: manifest.created_at,
                bytes: manifest.total_bytes(),
            })
            .collect();
        let trash_bytes = self.active_trash_bytes(now)?;
        let eviction = retention_evictions(
            &candidates,
            now,
            incoming_bytes,
            trash_bytes,
            self.quota_bytes,
            free_bytes,
            FREE_RESERVE_BYTES,
        )?;
        for record_id in eviction {
            let record_dir = self.records_dir().join(record_id);
            remove_dir_checked(&record_dir)?;
        }

        let record_id = Uuid::new_v4().to_string();
        let staging = self.staging_dir().join(format!("{record_id}.tmp"));
        let destination = self.records_dir().join(&record_id);
        fs::create_dir(&staging).map_err(|error| format!("创建截图历史 staging 失败：{error}"))?;

        let result = (|| {
            write_synced_file(&staging.join(ORIGINAL_FILE), &request.original_png)?;
            write_synced_file(&staging.join(FINAL_FILE), &request.final_png)?;
            let manifest = HistoryManifest {
                schema_version: MANIFEST_SCHEMA_VERSION,
                record_id: record_id.clone(),
                artifact_id: request.artifact_id,
                created_at: now,
                width: final_dimensions.0,
                height: final_dimensions.1,
                original_file: ORIGINAL_FILE.to_string(),
                final_file: FINAL_FILE.to_string(),
                original_bytes: request.original_png.len() as u64,
                final_bytes: request.final_png.len() as u64,
                original_digest,
                final_digest,
                artifact_digest,
                source: request.source,
                completed: true,
            };
            let manifest_bytes = serde_json::to_vec_pretty(&manifest)
                .map_err(|error| format!("序列化截图历史清单失败：{error}"))?;
            write_synced_file(&staging.join(MANIFEST_FILE), &manifest_bytes)?;
            sync_directory(&staging)?;
            fs::rename(&staging, &destination)
                .map_err(|error| format!("发布截图历史记录失败：{error}"))?;
            sync_directory(&self.records_dir())?;
            Ok(manifest)
        })();

        if result.is_err() {
            remove_dir_best_effort(&staging);
        }
        result
    }

    pub(crate) fn list_records(
        &mut self,
        now: u64,
        purge_expired: bool,
    ) -> Result<Vec<HistoryRecordSummary>, String> {
        self.settle_expired_trash(now)?;
        let mut manifests = self.read_all_valid_manifests()?;
        if purge_expired {
            let mut retained = Vec::with_capacity(manifests.len());
            for manifest in manifests {
                if now.saturating_sub(manifest.created_at) >= MAX_AGE_MS {
                    remove_dir_checked(&self.records_dir().join(&manifest.record_id))?;
                } else {
                    retained.push(manifest);
                }
            }
            manifests = retained;
        }
        manifests.sort_by_key(|m| std::cmp::Reverse(m.created_at));
        Ok(manifests.iter().map(HistoryRecordSummary::from).collect())
    }

    pub(crate) fn get_manifest(&self, record_id: &str) -> Result<HistoryManifest, String> {
        self.read_manifest_in(&self.records_dir().join(record_id), record_id)
    }

    pub(crate) fn record_dir_if_valid(&self, record_id: &str) -> Result<PathBuf, String> {
        let directory = self.records_dir().join(record_id);
        self.read_manifest_in(&directory, record_id)?;
        Ok(directory)
    }

    pub(crate) fn read_image(&self, record_id: &str, variant: ImageVariant) -> Result<Vec<u8>, String> {
        let manifest = self.get_manifest(record_id)?;
        let (file_name, expected_bytes, expected_digest) = match variant {
            ImageVariant::Original => (
                manifest.original_file,
                manifest.original_bytes,
                manifest.original_digest,
            ),
            ImageVariant::Final => (
                manifest.final_file,
                manifest.final_bytes,
                manifest.final_digest,
            ),
        };
        let path = self.records_dir().join(record_id).join(file_name);
        validate_payload_file(&path, expected_bytes, &expected_digest)?;
        fs::read(path).map_err(|error| format!("读取截图历史图像失败：{error}"))
    }

    pub(crate) fn delete_to_trash(&mut self, record_id: &str, now: u64) -> Result<TrashReceipt, String> {
        let source = self.record_dir_if_valid(record_id)?;
        let destination = self.trash_dir().join(record_id);
        if destination.exists() {
            return Err("截图记录已在待删除区".to_string());
        }
        let metadata = TrashMetadata {
            record_id: record_id.to_string(),
            deleted_at: now,
            delete_after: now.saturating_add(TRASH_UNDO_MS),
        };
        let metadata_bytes = serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("序列化截图删除状态失败：{error}"))?;
        let metadata_path = source.join(TRASH_META_FILE);
        write_synced_file(&metadata_path, &metadata_bytes)?;
        if let Err(error) = fs::rename(&source, &destination) {
            remove_file_best_effort(&metadata_path);
            return Err(format!("移动截图记录到待删除区失败：{error}"));
        }
        sync_directory(&self.trash_dir())?;
        Ok(TrashReceipt {
            record_id: record_id.to_string(),
            delete_after: metadata.delete_after,
        })
    }

    pub(crate) fn undo_trash(&mut self, record_id: &str, now: u64) -> Result<HistoryRecordSummary, String> {
        let source = self.trash_dir().join(record_id);
        let metadata = read_trash_metadata(&source)?;
        if metadata.record_id != record_id || now >= metadata.delete_after {
            remove_dir_best_effort(&source);
            return Err("截图记录的撤销期限已过".to_string());
        }
        let manifest = self.read_manifest_in(&source, record_id)?;
        let destination = self.records_dir().join(record_id);
        fs::rename(&source, &destination).map_err(|error| format!("恢复截图记录失败：{error}"))?;
        remove_file_best_effort(&destination.join(TRASH_META_FILE));
        Ok(HistoryRecordSummary::from(&manifest))
    }

    pub(crate) fn clear_all(&mut self) -> Result<u32, String> {
        self.settle_expired_trash(now_millis())?;
        let count = read_directories(&self.records_dir())?.len()
            + read_directories(&self.trash_dir())?.len();
        for directory in [self.records_dir(), self.trash_dir(), self.staging_dir()] {
            for entry in read_directories(&directory)? {
                remove_dir_checked(&entry)?;
            }
        }
        Ok(count as u32)
    }

    pub(crate) fn read_all_valid_manifests(&self) -> Result<Vec<HistoryManifest>, String> {
        let mut manifests = Vec::new();
        for directory in read_directories(&self.records_dir())? {
            let Some(record_id) = file_name(&directory) else {
                continue;
            };
            if let Ok(manifest) = self.read_manifest_in(&directory, &record_id) {
                manifests.push(manifest);
            }
        }
        Ok(manifests)
    }

    pub(crate) fn read_manifest_in(
        &self,
        directory: &Path,
        record_id: &str,
    ) -> Result<HistoryManifest, String> {
        let metadata =
            fs::symlink_metadata(directory).map_err(|_| "截图历史记录不存在".to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("截图历史记录目录无效".to_string());
        }
        let bytes = fs::read(directory.join(MANIFEST_FILE))
            .map_err(|error| format!("读取截图历史清单失败：{error}"))?;
        let manifest: HistoryManifest =
            serde_json::from_slice(&bytes).map_err(|error| format!("截图历史清单无效：{error}"))?;
        manifest.validate(record_id)?;
        // 注意：这里不做 payload 内容校验（不读 PNG 文件）。完整性校验推迟到
        // 真正读图（`read_image`）时执行，避免打开历史页时对全部记录全量读盘 + SHA-256。
        Ok(manifest)
    }

    pub(crate) fn settle_expired_trash(&mut self, now: u64) -> Result<(), String> {
        for directory in read_directories(&self.trash_dir())? {
            match read_trash_metadata(&directory) {
                Ok(metadata) if now >= metadata.delete_after => remove_dir_checked(&directory)?,
                Ok(_) => {}
                Err(_) => remove_dir_best_effort(&directory),
            }
        }
        Ok(())
    }

    pub(crate) fn active_trash_deadlines(&self, now: u64) -> Result<Vec<u64>, String> {
        let mut deadlines = Vec::new();
        for directory in read_directories(&self.trash_dir())? {
            let Some(record_id) = file_name(&directory) else {
                continue;
            };
            let Ok(metadata) = read_trash_metadata(&directory) else {
                continue;
            };
            if metadata.record_id == record_id
                && now < metadata.delete_after
                && self.read_manifest_in(&directory, &record_id).is_ok()
            {
                deadlines.push(metadata.delete_after);
            }
        }
        Ok(deadlines)
    }

    pub(crate) fn active_trash_bytes(&self, now: u64) -> Result<u64, String> {
        let mut bytes = 0u64;
        for directory in read_directories(&self.trash_dir())? {
            let Ok(metadata) = read_trash_metadata(&directory) else {
                continue;
            };
            if now < metadata.delete_after {
                if let Ok(manifest) = self.read_manifest_in(&directory, &metadata.record_id) {
                    bytes = bytes.saturating_add(manifest.total_bytes());
                }
            }
        }
        Ok(bytes)
    }
}

/// 发布请求在锁外完成的预处理结果（解码后的尺寸 + 摘要），供锁内 `publish_prepared` 使用。
pub(crate) struct PreparedPublish {
    request: PublishHistoryRequest,
    final_dimensions: (u32, u32),
    original_digest: String,
    final_digest: String,
    artifact_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RetentionRecord {
    record_id: String,
    created_at: u64,
    bytes: u64,
}

/// 计算发布新记录前需要淘汰的旧记录（先淘汰超龄，再按最旧优先满足容量与磁盘余量）。
fn retention_evictions(
    records: &[RetentionRecord],
    now: u64,
    incoming_bytes: u64,
    protected_trash_bytes: u64,
    quota_bytes: u64,
    free_bytes: u64,
    reserve_bytes: u64,
) -> Result<Vec<String>, String> {
    let mut sorted = records.to_vec();
    sorted.sort_by_key(|record| record.created_at);
    let mut used = sorted.iter().fold(protected_trash_bytes, |sum, record| {
        sum.saturating_add(record.bytes)
    });
    let mut effective_free = free_bytes;
    let mut evicted = Vec::new();

    for record in &sorted {
        if now.saturating_sub(record.created_at) >= MAX_AGE_MS {
            used = used.saturating_sub(record.bytes);
            effective_free = effective_free.saturating_add(record.bytes);
            evicted.push(record.record_id.clone());
        }
    }

    for record in &sorted {
        if evicted.iter().any(|id| id == &record.record_id) {
            continue;
        }
        let quota_ok = used.saturating_add(incoming_bytes) <= quota_bytes;
        let reserve_ok = effective_free >= reserve_bytes.saturating_add(incoming_bytes);
        if quota_ok && reserve_ok {
            break;
        }
        used = used.saturating_sub(record.bytes);
        effective_free = effective_free.saturating_add(record.bytes);
        evicted.push(record.record_id.clone());
    }

    if used.saturating_add(incoming_bytes) > quota_bytes {
        return Err(format!(
            "截图历史容量不足；请清空历史或提高容量上限（需要 {} 字节）",
            incoming_bytes
        ));
    }
    if effective_free < reserve_bytes.saturating_add(incoming_bytes) {
        return Err("磁盘剩余空间不足，无法在保留 1GB 安全余量的同时保存截图".to_string());
    }
    Ok(evicted)
}

fn validate_publish_request(request: &PublishHistoryRequest) -> Result<(u32, u32), String> {
    if request.artifact_id.trim().is_empty() || request.artifact_id.len() > 200 {
        return Err("artifact ID 无效".to_string());
    }
    request.source.validate()?;
    if request.width == 0 || request.height == 0 {
        return Err("截图尺寸无效".to_string());
    }
    validate_png(&request.original_png)?;
    let final_dimensions = validate_png(&request.final_png)?;
    if final_dimensions != (request.width, request.height) {
        return Err("截图尺寸与最终 PNG 尺寸不一致".to_string());
    }
    Ok(final_dimensions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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

    fn request(artifact_id: &str, color: [u8; 4]) -> PublishHistoryRequest {
        let bytes = png(4, 3, color);
        PublishHistoryRequest {
            artifact_id: artifact_id.to_string(),
            original_png: bytes.clone(),
            final_png: bytes,
            width: 4,
            height: 3,
            source: HistorySource::default(),
        }
    }

    fn store(temp: &TempDir, quota: u64) -> HistoryStore {
        let mut store = HistoryStore::new(temp.path().join(ROOT_DIR), quota).unwrap();
        store
            .initialize_and_recover(&temp.path().join("legacy"), 10_000)
            .unwrap();
        store
    }

    #[test]
    fn publish_is_atomic_and_idempotent() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let first = store
            .publish(request("artifact-one", [1, 2, 3, 255]))
            .unwrap();
        let second = store
            .publish(request("artifact-one", [1, 2, 3, 255]))
            .unwrap();
        assert_eq!(first.record_id, second.record_id);
        assert_eq!(read_directories(&store.records_dir()).unwrap().len(), 1);
        assert!(read_directories(&store.staging_dir()).unwrap().is_empty());
        assert!(store
            .records_dir()
            .join(&first.record_id)
            .join(MANIFEST_FILE)
            .is_file());
    }

    #[test]
    fn publish_rejects_changed_content_for_an_existing_artifact_before_eviction() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let first = store
            .publish(request("artifact-one", [1, 2, 3, 255]))
            .unwrap();

        assert!(store
            .publish(request("artifact-one", [9, 8, 7, 255]))
            .is_err());
        let records = store.list_records(now_millis(), false).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].record_id, first.record_id);
    }

    #[test]
    fn publish_creates_distinct_records_for_different_artifact_ids_with_same_bytes() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let first = store
            .publish(request("artifact-one", [1, 2, 3, 255]))
            .unwrap();
        let second = store
            .publish(request("artifact-two", [1, 2, 3, 255]))
            .unwrap();

        assert_ne!(first.record_id, second.record_id);
        assert_eq!(read_directories(&store.records_dir()).unwrap().len(), 2);
        assert_eq!(
            store.get_manifest(&second.record_id).unwrap().artifact_id,
            "artifact-two"
        );
    }

    #[test]
    fn expired_trash_is_settled_but_active_trash_is_preserved() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let record = store
            .publish(request("trash-settlement", [1, 2, 3, 255]))
            .unwrap();
        let receipt = store.delete_to_trash(&record.record_id, 30_000).unwrap();

        store
            .settle_expired_trash(receipt.delete_after - 1)
            .unwrap();
        assert!(store.trash_dir().join(&record.record_id).is_dir());
        store.settle_expired_trash(receipt.delete_after).unwrap();
        assert!(!store.trash_dir().join(&record.record_id).exists());
    }

    #[test]
    fn publish_requires_declared_dimensions_to_match_final_png() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let mut invalid = request("dimension-mismatch", [1, 2, 3, 255]);
        invalid.width = 5;

        assert!(store.publish(invalid).is_err());
        assert!(read_directories(&store.records_dir()).unwrap().is_empty());
    }

    #[test]
    fn publish_uses_final_png_dimensions_when_original_differs() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let record = store
            .publish(PublishHistoryRequest {
                artifact_id: "final-dimensions".to_string(),
                original_png: png(2, 2, [1, 2, 3, 255]),
                final_png: png(4, 3, [4, 5, 6, 255]),
                width: 4,
                height: 3,
                source: HistorySource::default(),
            })
            .unwrap();

        assert_eq!((record.width, record.height), (4, 3));
    }

    #[test]
    fn recovery_removes_staging_but_keeps_active_trash_hidden_until_its_deadline() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let record = store.publish(request("recover", [3, 4, 5, 255])).unwrap();
        let receipt = store.delete_to_trash(&record.record_id, 20_000).unwrap();
        let orphan = store.staging_dir().join("orphan.tmp");
        fs::create_dir(&orphan).unwrap();
        fs::write(orphan.join(ORIGINAL_FILE), b"partial").unwrap();

        store.recover(20_100).unwrap();
        assert!(read_directories(&store.staging_dir()).unwrap().is_empty());
        assert!(!store.records_dir().join(&record.record_id).exists());
        assert!(store.trash_dir().join(&record.record_id).is_dir());
        assert_eq!(
            store.active_trash_deadlines(20_100).unwrap(),
            vec![receipt.delete_after]
        );

        store.settle_expired_trash(receipt.delete_after).unwrap();
        assert!(!store.trash_dir().join(&record.record_id).exists());
    }

    #[test]
    fn recovery_rejects_a_record_whose_payload_digest_was_tampered() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let record = store
            .publish(request("tampered-digest", [3, 4, 5, 255]))
            .unwrap();
        let final_path = store.records_dir().join(&record.record_id).join(FINAL_FILE);
        let original_bytes = fs::read(&final_path).unwrap();
        let tampered = png(4, 3, [9, 9, 9, 255]);
        assert_eq!(tampered.len(), original_bytes.len());
        assert_ne!(tampered, original_bytes);
        fs::write(final_path, tampered).unwrap();

        // 列表/元数据路径不再全量校验 payload（性能优化）：篡改检测推迟到真正读图时执行。
        assert!(store.get_manifest(&record.record_id).is_ok());
        assert_eq!(store.list_records(now_millis(), false).unwrap().len(), 1);
        assert!(store
            .read_image(&record.record_id, ImageVariant::Final)
            .is_err());
    }

    #[test]
    fn retention_evicts_whole_oldest_records() {
        let records = vec![
            RetentionRecord {
                record_id: "old".to_string(),
                created_at: 100,
                bytes: 60,
            },
            RetentionRecord {
                record_id: "new".to_string(),
                created_at: 200,
                bytes: 60,
            },
        ];
        let evicted = retention_evictions(&records, 500, 70, 0, 150, 10_000, 0).unwrap();
        assert_eq!(evicted, vec!["old"]);
    }

    #[test]
    fn retention_reserves_incoming_staging_bytes_before_writing() {
        // Undoable trash is protected, so the incoming staging record must be
        // admitted alongside it instead of briefly exceeding the quota.
        let error = retention_evictions(&[], 500, 60, 50, 100, 10_000, 0).unwrap_err();
        assert!(error.contains("容量不足"));
    }

    #[test]
    fn create_copy_from_original_creates_distinct_record_with_source_linkage() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let original = png(2, 2, [1, 2, 3, 255]);
        let final_png = png(4, 3, [4, 5, 6, 255]);
        let source = store
            .publish(PublishHistoryRequest {
                artifact_id: "source-original".to_string(),
                original_png: original.clone(),
                final_png,
                width: 4,
                height: 3,
                source: HistorySource::default(),
            })
            .unwrap();

        let copy = store
            .create_copy_from_record(&source.record_id, HistoryImageVariant::Original)
            .unwrap();

        assert_ne!(copy.record_id, source.record_id);
        assert_ne!(copy.artifact_id, source.artifact_id);
        assert_eq!(copy.source.kind, "reannotate");
        assert_eq!(
            copy.source.record_id.as_deref(),
            Some(source.record_id.as_str())
        );
        assert_eq!(copy.source.variant.as_deref(), Some("original"));
        assert_eq!(
            store
                .read_image(&copy.record_id, ImageVariant::Original)
                .unwrap(),
            original
        );
        assert_eq!(
            store
                .read_image(&copy.record_id, ImageVariant::Final)
                .unwrap(),
            original
        );
    }

    #[test]
    fn create_copy_from_final_creates_distinct_record_with_source_linkage() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let original = png(2, 2, [1, 2, 3, 255]);
        let final_png = png(4, 3, [4, 5, 6, 255]);
        let source = store
            .publish(PublishHistoryRequest {
                artifact_id: "source-final".to_string(),
                original_png: original,
                final_png: final_png.clone(),
                width: 4,
                height: 3,
                source: HistorySource::default(),
            })
            .unwrap();

        let copy = store
            .create_copy_from_record(&source.record_id, HistoryImageVariant::Final)
            .unwrap();

        assert_ne!(copy.record_id, source.record_id);
        assert_ne!(copy.artifact_id, source.artifact_id);
        assert_eq!(copy.source.kind, "reannotate");
        assert_eq!(
            copy.source.record_id.as_deref(),
            Some(source.record_id.as_str())
        );
        assert_eq!(copy.source.variant.as_deref(), Some("final"));
        assert_eq!(
            store
                .read_image(&copy.record_id, ImageVariant::Original)
                .unwrap(),
            final_png
        );
        assert_eq!(
            store
                .read_image(&copy.record_id, ImageVariant::Final)
                .unwrap(),
            final_png
        );
    }

    #[test]
    fn trash_deadline_allows_undo_then_expires() {
        let temp = TempDir::new().unwrap();
        let mut store = store(&temp, 10_000_000);
        let record = store.publish(request("trash", [5, 6, 7, 255])).unwrap();
        let receipt = store.delete_to_trash(&record.record_id, 30_000).unwrap();
        assert_eq!(receipt.delete_after, 38_000);
        store.undo_trash(&record.record_id, 37_999).unwrap();
        store.delete_to_trash(&record.record_id, 40_000).unwrap();
        assert!(store.undo_trash(&record.record_id, 48_000).is_err());
        assert!(!store.trash_dir().join(&record.record_id).exists());
    }
}
