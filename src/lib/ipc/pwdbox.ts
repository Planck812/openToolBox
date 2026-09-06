import { invoke } from '@tauri-apps/api/core';

/**
 * 读取密码库文档（v2）：返回 JSON 字符串；文件不存在时返回 `null`。
 *
 * 文档本身明文落盘，**每条记录的 `password` 字段是 AES-256-GCM 密文**。
 * 因此本调用不需要主密钥、不会触发系统凭据库授权（macOS 上即不弹钥匙串对话框）。
 * 取明文密码须另行调用 {@link pwdboxDecryptField}。
 */
export const pwdboxLoad = (): Promise<string | null> => invoke<string | null>('pwdbox_load');

/**
 * 落盘密码库 JSON 字符串（其中 `password` 应已是密文）。
 *
 * 后端带兜底：若发现明文密码会先加密再写入，明文密码不会落盘。
 */
export const pwdboxSave = (data: string): Promise<void> => invoke('pwdbox_save', { data });

/**
 * 预热主密钥：把密钥读入后端进程缓存，使后续查看/复制无需再访问系统凭据库。
 *
 * 于工具页挂载时调用，让系统凭据库的授权交互发生在「进入工具页」这一步，
 * 而不是打断查看密码的操作。返回是否预热成功；失败不影响浏览已有条目。
 */
export const pwdboxPrepareKey = (): Promise<boolean> => invoke<boolean>('pwdbox_prepare_key');

/**
 * 解密单条密码字段（查看/复制前调用，须已通过 {@link pwdboxAuthenticate}）。
 * 空串原样返回；非密文（历史遗留明文）原样返回。
 */
export const pwdboxDecryptField = (cipher: string): Promise<string> =>
  invoke<string>('pwdbox_decrypt_field', { cipher });

/**
 * 加密单条密码字段（新增/修改密码时调用）。空串原样返回。
 */
export const pwdboxEncryptField = (plain: string): Promise<string> =>
  invoke<string>('pwdbox_encrypt_field', { plain });

/**
 * 发起系统开机密码 / Windows Hello 身份验证。
 * 若在 10 分钟免密有效期内，将直接返回 true（不弹窗）。
 */
export const pwdboxAuthenticate = (prompt?: string | null): Promise<boolean> =>
  invoke<boolean>('pwdbox_authenticate', { prompt: prompt ?? null });

/**
 * 检查当前是否在 10 分钟免密有效期内。
 */
export const pwdboxAuthCheck = (): Promise<boolean> => invoke<boolean>('pwdbox_auth_check');

/**
 * 主动锁定密码夹（清除免密会话）。
 */
export const pwdboxAuthLock = (): Promise<void> => invoke<void>('pwdbox_auth_lock');

/**
 * 读取 Curl 请求历史（解密 / 迁移后返回 JSON 字符串；不存在返回 `null`）。
 * 数据由 Rust 侧 AES-256-GCM 加密落盘，与密码夹共用加密实现但使用独立主密钥。
 */
export const curlStorageLoad = (): Promise<string | null> =>
  invoke<string | null>('curl_storage_load');

/**
 * 加密并落盘 Curl 请求历史 JSON 字符串。
 */
export const curlStorageSave = (data: string): Promise<void> =>
  invoke('curl_storage_save', { data });
