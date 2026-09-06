import type { PasswordBoxItem } from './password-box-model';
import { pwdboxLoad, pwdboxSave } from '@/lib/ipc/pwdbox';
import i18n from '@/i18n';

/**
 * 密码库文档格式。
 *
 * - v1：整个文档由后端 AES-GCM 加密后落盘。
 * - v2（当前）：文档本身明文落盘，仅每条记录的 `password` 字段单独加密。
 *   如此列出条目无需主密钥，打开密码夹不会触发系统凭据库授权
 *   （macOS 上即不弹钥匙串对话框）。
 *
 * 后端读取时会把 v1 就地迁移为 v2，故此处读到的应始终是 v2；
 * 仍接受 v1 以兼容后端迁移失败时的降级读取。
 */
const DOCUMENT_VERSION = 2;

type PasswordBoxDocument = {
  version: number;
  items: PasswordBoxItem[];
};

let pendingWrite: Promise<void> = Promise.resolve();

const cloneItems = (items: PasswordBoxItem[]) => items.map((item) => ({ ...item }));

const assertDocumentShape = (value: unknown): PasswordBoxDocument => {
  if (!value || typeof value !== 'object') {
    throw new Error(i18n.global.t('tools.pwd_box.error_file_parse_failed'));
  }

  const document = value as Partial<PasswordBoxDocument>;
  // 同时接受 v1 与 v2：后端负责把 v1 迁移为 v2，这里不因版本号新旧而拒绝读取，
  // 否则一次格式升级就会让既有数据「解析失败」而不可用。
  const version = document.version;
  if ((version !== 1 && version !== 2) || !Array.isArray(document.items)) {
    throw new Error(i18n.global.t('tools.pwd_box.error_file_parse_failed'));
  }

  return {
    version,
    items: document.items as PasswordBoxItem[],
  };
};

/**
 * Rust 侧凭据库不可用时返回带该稳定标记的错误，前端据此提示「当前环境不支持加密存储」。
 */
const isUnsupportedStorageError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('pwdbox: encrypted storage unavailable');
};

/**
 * 从加密落盘的密码库读取全部密码记录（后端负责解密与旧明文迁移）。
 */
export const loadPasswordBoxItems = async (): Promise<PasswordBoxItem[]> => {
  let content: string | null;
  try {
    content = await pwdboxLoad();
  } catch (error) {
    if (isUnsupportedStorageError(error)) {
      throw new Error(i18n.global.t('tools.pwd_box.error_unsupported_storage'));
    }
    throw error;
  }

  if (content === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    return assertDocumentShape(parsed).items;
  } catch {
    throw new Error(i18n.global.t('tools.pwd_box.error_file_parse_failed'));
  }
};

/**
 * 将全部密码记录加密落盘（后端负责 AES-GCM 加密，主密钥存系统凭据库）。
 */
export const savePasswordBoxItems = async (items: PasswordBoxItem[]): Promise<void> => {
  const document: PasswordBoxDocument = {
    version: DOCUMENT_VERSION,
    items: cloneItems(items),
  };

  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      try {
        await pwdboxSave(JSON.stringify(document, null, 2));
      } catch (error) {
        if (isUnsupportedStorageError(error)) {
          throw new Error(i18n.global.t('tools.pwd_box.error_unsupported_storage'));
        }
        throw error;
      }
    });

  await pendingWrite;
};
