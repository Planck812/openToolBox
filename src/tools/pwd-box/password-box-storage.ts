import type { PasswordBoxItem } from './password-box-model';
import { pwdboxLoad, pwdboxSave } from '@/lib/ipc/pwdbox';
import i18n from '@/i18n';

type PasswordBoxDocument = {
  version: 1;
  items: PasswordBoxItem[];
};

let pendingWrite: Promise<void> = Promise.resolve();

const cloneItems = (items: PasswordBoxItem[]) => items.map((item) => ({ ...item }));

const assertDocumentShape = (value: unknown): PasswordBoxDocument => {
  if (!value || typeof value !== 'object') {
    throw new Error(i18n.global.t('tools.pwd_box.error_file_parse_failed'));
  }

  const document = value as Partial<PasswordBoxDocument>;
  if (document.version !== 1 || !Array.isArray(document.items)) {
    throw new Error(i18n.global.t('tools.pwd_box.error_file_parse_failed'));
  }

  return {
    version: 1,
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
    version: 1,
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
