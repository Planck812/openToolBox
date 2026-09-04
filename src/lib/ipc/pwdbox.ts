import { invoke } from '@tauri-apps/api/core';

/**
 * 读取密码库：返回解密后的 JSON 字符串；文件不存在时返回 `null`。
 * 数据由 Rust 侧 AES-256-GCM 加密落盘，主密钥存系统凭据库。
 */
export const pwdboxLoad = (): Promise<string | null> => invoke<string | null>('pwdbox_load');

/**
 * 加密并落盘密码库 JSON 字符串。
 */
export const pwdboxSave = (data: string): Promise<void> => invoke('pwdbox_save', { data });

/**
 * 读取 Curl 请求历史（解密 / 迁移后返回 JSON 字符串；不存在返回 `null`）。
 * 数据由 Rust 侧 AES-256-GCM 加密落盘，与密码夹共用加密实现但使用独立主密钥。
 */
export const curlStorageLoad = (): Promise<string | null> => invoke<string | null>('curl_storage_load');

/**
 * 加密并落盘 Curl 请求历史 JSON 字符串。
 */
export const curlStorageSave = (data: string): Promise<void> => invoke('curl_storage_save', { data });
