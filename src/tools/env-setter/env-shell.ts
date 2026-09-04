import { invoke } from '@tauri-apps/api/core';

export type EnvPlatform = 'windows' | 'macos' | 'linux';
export type EnvVariableScope = 'user' | 'system' | 'process' | 'profile' | 'bashrc' | 'zshrc';
export type EnvVariableValueType =
  | 'REG_SZ'
  | 'REG_EXPAND_SZ'
  | 'shell_literal'
  | 'shell_expression'
  | 'process';

/** Matches the Rust `EnvVariable` DTO serialized with `camelCase`. */
export interface EnvVariable {
  key: string;
  value: string;
  valueType: EnvVariableValueType;
  scope: EnvVariableScope;
  sourceLabel: string;
  writable: boolean;
}

/** Matches the Rust `EnvTargetInfo` DTO serialized with `camelCase`. */
export interface EnvTarget {
  id: string;
  path: string;
  exists: boolean;
  recommended: boolean;
}

export type EnvTargetInfo = EnvTarget;

/** Matches the Rust `EnvPlatformInfo` DTO serialized with `camelCase`. */
export interface EnvPlatformInfo {
  platform: EnvPlatform;
  supportsDirectWrite: boolean;
  availableTargets: EnvTarget[];
}

/** Matches the Rust `ListEnvResult` DTO serialized with `camelCase`. */
export interface ListEnvResult {
  ok: boolean;
  variables: EnvVariable[];
  message: string;
}

/** Matches the Rust `GetEnvResult` DTO serialized with `camelCase`. */
export interface GetEnvResult {
  ok: boolean;
  value: string | null;
  variable: EnvVariable | null;
  message: string;
}

/** Matches the Rust `PreviewEnvWriteRequest` DTO serialized with `camelCase`. */
export interface PreviewEnvWriteRequest {
  key: string;
  value: string;
  targets: string[];
}

export interface PreviewEnvDeleteRequest {
  key: string;
}

/** Matches the Rust `EnvTargetPreview` DTO serialized with `camelCase`. */
export interface EnvTargetPreview {
  id: string;
  path: string;
  exists: boolean;
  action: string;
  beforeLines: string[];
  afterLines: string[];
  diff: string;
  hash: string;
  warnings: string[];
}

/** Matches the Rust `EnvWritePreview` DTO serialized with `camelCase`. */
export interface EnvWritePreview {
  previewId: string;
  requiresConfirmation: boolean;
  targets: EnvTargetPreview[];
  warnings: string[];
}

/** Matches the Rust `ApplyEnvWriteRequest` DTO serialized with `camelCase`. */
export interface ApplyEnvWriteRequest {
  previewId: string;
}

/** Matches the Rust `SetEnvResult` DTO serialized with `camelCase`. */
export interface SetEnvResult {
  ok: boolean;
  message: string;
  warnings: string[];
}

export const get_env_platform_info = (): Promise<EnvPlatformInfo> =>
  invoke<EnvPlatformInfo>('get_env_platform_info');

export const list_user_env_vars = (): Promise<ListEnvResult> => invoke<ListEnvResult>('list_env_vars');

export const get_user_env_var = (key: string): Promise<GetEnvResult> =>
  invoke<GetEnvResult>('get_env_var', { key });

export const preview_env_write = (request: PreviewEnvWriteRequest): Promise<EnvWritePreview> =>
  invoke<EnvWritePreview>('preview_env_write', { request });

export const preview_env_delete = (key: string): Promise<EnvWritePreview> =>
  invoke<EnvWritePreview>('preview_env_delete', { request: { key } satisfies PreviewEnvDeleteRequest });

export const apply_env_write = (previewId: string): Promise<SetEnvResult> =>
  invoke<SetEnvResult>('apply_env_write', { request: { previewId } });
