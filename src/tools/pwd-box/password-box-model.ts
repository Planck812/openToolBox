export interface PasswordBoxItem {
  id: string;
  site: string;
  username: string;
  password: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export const PASSWORD_MASK = '***';

const normalizeText = (value: string | undefined): string => value?.trim() ?? '';

/**
 * 创建一条新的密码记录，初始字段统一留空。
 */
export const createPasswordBoxItem = (timestamp: string, id: string): PasswordBoxItem => ({
  id,
  site: '',
  username: '',
  password: '',
  note: '',
  createdAt: timestamp,
  updatedAt: timestamp,
});

/**
 * 更新密码记录，并在写入前统一清理首尾空格。
 */
export const updatePasswordBoxItem = (
  item: PasswordBoxItem,
  patch: Partial<Pick<PasswordBoxItem, 'site' | 'username' | 'password' | 'note'>>,
  timestamp: string,
): PasswordBoxItem => ({
  ...item,
  ...Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, typeof value === 'string' ? normalizeText(value) : value]),
  ),
  updatedAt: timestamp,
});

/**
 * 删除目标密码记录。
 */
export const deletePasswordBoxItem = (items: PasswordBoxItem[], itemId: string): PasswordBoxItem[] =>
  items.filter((item) => item.id !== itemId);

/**
 * 按网站与备注执行大小写无关的模糊搜索。
 */
export const searchPasswordBoxItems = (items: PasswordBoxItem[], keyword: string): PasswordBoxItem[] => {
  const normalized = normalizeText(keyword).toLowerCase();
  if (!normalized) {
    return items;
  }

  return items.filter((item) => `${item.site}\n${item.note}`.toLowerCase().includes(normalized));
};

/**
 * 始终按最近更新时间倒序展示。
 */
export const sortPasswordBoxItems = (items: PasswordBoxItem[]): PasswordBoxItem[] =>
  [...items].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

/**
 * 密码默认始终以统一掩码展示。
 */
export const maskPassword = (_value: string): string => PASSWORD_MASK;
