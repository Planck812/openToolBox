<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next';
import { copyText } from '@/lib/clipboard';
import { pwdboxAuthenticate, pwdboxAuthCheck, pwdboxAuthLock } from '@/lib/ipc/pwdbox';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import {
  createPasswordBoxItem,
  deletePasswordBoxItem,
  maskPassword,
  searchPasswordBoxItems,
  sortPasswordBoxItems,
  updatePasswordBoxItem,
  type PasswordBoxItem,
} from './password-box-model';
import { loadPasswordBoxItems, savePasswordBoxItems } from './password-box-storage';
import {
  DEFAULT_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  estimatePasswordStrength,
  generatePassword,
  type PasswordStrength,
} from './password-generator';

const { t } = useI18n();
const appStore = useAppStore();
const items = ref<PasswordBoxItem[]>([]);
const searchKeyword = ref('');
const selectedItemId = ref<string | null>(null);
const revealedIds = ref<string[]>([]);
const loaded = ref(false);
const isUnlocked = ref(false);
const authenticating = ref(false);
let authExpiryTimer: ReturnType<typeof setTimeout> | null = null;
const generatorOpen = ref(false);
const genLength = ref(DEFAULT_PASSWORD_LENGTH);
const genUseUpper = ref(true);
const genUseLower = ref(true);
const genUseDigits = ref(true);
const genUseSymbols = ref(true);
const genExcludeAmbiguous = ref(false);
const generatedPassword = ref('');
const generatedStrength = ref<PasswordStrength | null>(null);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } =
  useResizablePanel({
    minFirstWidth: 240,
    minSecondWidth: 420,
  });

const strengthToneClass: Record<PasswordStrength, string> = {
  weak: 'text-destructive',
  fair: 'text-amber-500',
  good: 'text-sky-500',
  strong: 'text-emerald-500',
};

const strengthLabel = (strength: PasswordStrength) => t(`tools.pwd_box.gen_strength_${strength}`);

const visibleItems = computed(() =>
  sortPasswordBoxItems(searchPasswordBoxItems(items.value, searchKeyword.value)),
);
const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedItemId.value) ?? null,
);

const resetAuthSessionTimer = () => {
  if (authExpiryTimer) {
    clearTimeout(authExpiryTimer);
  }
  // 10 分钟免密有效期后自动清除明文显示与解锁标志
  authExpiryTimer = setTimeout(
    () => {
      isUnlocked.value = false;
      revealedIds.value = [];
    },
    10 * 60 * 1000,
  );
};

const ensureAuthenticated = async (promptMessage?: string): Promise<boolean> => {
  if (authenticating.value) {
    return false;
  }

  try {
    authenticating.value = true;
    const verified = await pwdboxAuthenticate(promptMessage);
    if (verified) {
      isUnlocked.value = true;
      resetAuthSessionTimer();
      return true;
    }
    appStore.showToast(t('tools.pwd_box.auth_canceled'), { type: 'info' });
    return false;
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : t('tools.pwd_box.auth_failed');
    appStore.showToast(message, { type: 'error' });
    return false;
  } finally {
    authenticating.value = false;
  }
};

const lockSession = async () => {
  try {
    await pwdboxAuthLock();
  } catch {
    // 忽略锁定异常
  }
  isUnlocked.value = false;
  revealedIds.value = [];
  if (authExpiryTimer) {
    clearTimeout(authExpiryTimer);
    authExpiryTimer = null;
  }
  appStore.showToast(t('tools.pwd_box.locked'), { type: 'info' });
};

/**
 * 生成密码记录唯一标识，优先复用浏览器原生 UUID。
 */
const createItemId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `pwd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * 列表变化后，自动回退到一个仍然可见的选中项。
 */
const ensureSelectedItem = () => {
  if (selectedItem.value && visibleItems.value.some((item) => item.id === selectedItem.value?.id)) {
    return;
  }

  selectedItemId.value = visibleItems.value[0]?.id ?? items.value[0]?.id ?? null;
};

/**
 * 将当前密码记录集合持久化到用户目录文件。
 */
const persistItems = async () => {
  try {
    await savePasswordBoxItems(items.value);
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : t('tools.pwd_box.save_failed');
    appStore.showToast(message, { type: 'error' });
  }
};

const isPasswordVisible = (itemId: string) => revealedIds.value.includes(itemId);

const toggleVisibility = async (itemId: string) => {
  if (isPasswordVisible(itemId)) {
    revealedIds.value = revealedIds.value.filter((id) => id !== itemId);
    return;
  }

  const ok = await ensureAuthenticated(t('tools.pwd_box.auth_prompt_view'));
  if (ok) {
    revealedIds.value = [...revealedIds.value, itemId];
  }
};

const createNewItem = async () => {
  const timestamp = new Date().toISOString();
  const nextItem = createPasswordBoxItem(timestamp, createItemId());
  items.value = [nextItem, ...items.value];
  selectedItemId.value = nextItem.id;
  await persistItems();
  appStore.showToast(t('tools.pwd_box.created'), { type: 'success' });
};

const selectItem = (itemId: string) => {
  selectedItemId.value = itemId;
};

const patchSelectedItem = async (
  patch: Partial<Pick<PasswordBoxItem, 'site' | 'username' | 'password' | 'note'>>,
) => {
  const current = selectedItem.value;
  if (!current) {
    return;
  }

  const timestamp = new Date().toISOString();
  items.value = items.value.map((item) =>
    item.id === current.id ? updatePasswordBoxItem(item, patch, timestamp) : item,
  );
  await persistItems();
};

const copyPassword = async () => {
  if (!selectedItem.value) {
    return;
  }

  const okAuth = await ensureAuthenticated(t('tools.pwd_box.auth_prompt_copy'));
  if (!okAuth) {
    return;
  }

  const ok = await copyText(selectedItem.value.password);
  appStore.showToast(t(ok ? 'tools.pwd_box.copy_success' : 'tools.pwd_box.copy_failed'), {
    type: ok ? 'success' : 'error',
  });
};

const clampGenLength = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_PASSWORD_LENGTH;
  }
  return Math.min(MAX_PASSWORD_LENGTH, Math.max(MIN_PASSWORD_LENGTH, Math.round(value)));
};

const onGenLengthInput = (raw: string | number) => {
  genLength.value = clampGenLength(Number(raw));
};

const runGeneratePassword = () => {
  try {
    const password = generatePassword({
      length: genLength.value,
      useUpper: genUseUpper.value,
      useLower: genUseLower.value,
      useDigits: genUseDigits.value,
      useSymbols: genUseSymbols.value,
      excludeAmbiguous: genExcludeAmbiguous.value,
    });
    generatedPassword.value = password;
    generatedStrength.value = estimatePasswordStrength(password);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/at least one character class/i.test(message) || /character pool is empty/i.test(message)) {
      appStore.showToast(t('tools.pwd_box.gen_error_no_class'), { type: 'error' });
    } else {
      appStore.showToast(t('tools.pwd_box.gen_error_failed'), { type: 'error' });
    }
  }
};

const onPasswordInputChange = async (event: Event, item: PasswordBoxItem) => {
  const target = event.target as HTMLInputElement;
  const currentPassword = item.password;
  const newPassword = target.value;
  if (newPassword === currentPassword) {
    return;
  }

  if (currentPassword) {
    const confirmed = window.confirm(t('tools.pwd_box.modify_password_confirm'));
    if (!confirmed) {
      target.value = currentPassword;
      return;
    }
  }

  const timestamp = new Date().toISOString();
  items.value = items.value.map((i) =>
    i.id === item.id ? updatePasswordBoxItem(i, { password: newPassword }, timestamp) : i,
  );
  await persistItems();
};

const fillGeneratedPassword = async () => {
  if (!selectedItem.value) {
    appStore.showToast(t('tools.pwd_box.gen_fill_no_selection'), { type: 'error' });
    return;
  }
  if (!generatedPassword.value) {
    return;
  }

  if (
    selectedItem.value.password &&
    selectedItem.value.password !== generatedPassword.value
  ) {
    const confirmed = window.confirm(t('tools.pwd_box.modify_password_confirm'));
    if (!confirmed) {
      return;
    }
  }

  await patchSelectedItem({ password: generatedPassword.value });
  if (!isPasswordVisible(selectedItem.value.id)) {
    revealedIds.value = [...revealedIds.value, selectedItem.value.id];
  }
  appStore.showToast(t('tools.pwd_box.gen_fill_success'), { type: 'success' });
};

const copyGeneratedPassword = async () => {
  if (!generatedPassword.value) {
    return;
  }

  const ok = await copyText(generatedPassword.value);
  appStore.showToast(t(ok ? 'tools.pwd_box.gen_copy_success' : 'tools.pwd_box.gen_copy_failed'), {
    type: ok ? 'success' : 'error',
  });
};

const deleteItem = async (itemId: string) => {
  if (!window.confirm(t('tools.pwd_box.delete_confirm'))) {
    return;
  }

  items.value = deletePasswordBoxItem(items.value, itemId);
  revealedIds.value = revealedIds.value.filter((id) => id !== itemId);
  if (selectedItemId.value === itemId) {
    selectedItemId.value = null;
  }
  ensureSelectedItem();
  await persistItems();
  appStore.showToast(t('tools.pwd_box.deleted'), { type: 'success' });
};

const formatUpdatedAt = (value: string) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

watch(
  visibleItems,
  () => {
    ensureSelectedItem();
  },
  { deep: true },
);

onMounted(async () => {
  try {
    items.value = await loadPasswordBoxItems();
    isUnlocked.value = await pwdboxAuthCheck().catch(() => false);
    if (isUnlocked.value) {
      resetAuthSessionTimer();
    }
  } catch (error) {
    items.value = [];
    const message =
      error instanceof Error && error.message ? error.message : t('tools.pwd_box.load_failed');
    appStore.showToast(message, { type: 'error' });
  } finally {
    loaded.value = true;
    ensureSelectedItem();
  }
});

onUnmounted(() => {
  if (authExpiryTimer) {
    clearTimeout(authExpiryTimer);
    authExpiryTimer = null;
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
    <div class="flex items-center justify-between gap-3 border-b border-border p-4">
      <div class="flex items-center gap-3">
        <div class="rounded-xl bg-primary/10 p-2 text-primary">
          <KeyRound class="h-5 w-5" />
        </div>
        <div>
          <h2 class="text-base font-semibold">{{ t('tools.pwd_box.name') }}</h2>
          <p class="text-xs text-muted-foreground">{{ t('tools.pwd_box.description') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="isUnlocked"
          data-testid="pwd-box-lock-button"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          :title="t('tools.pwd_box.lock_session')"
          @click="lockSession"
        >
          <Lock class="h-3.5 w-3.5" />
          {{ t('tools.pwd_box.lock_session') }}
        </button>
        <button
          data-testid="pwd-box-create-button"
          type="button"
          class="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="createNewItem"
        >
          <Plus class="h-4 w-4" />
          {{ t('tools.pwd_box.new_item') }}
        </button>
      </div>
    </div>

    <div
      ref="containerRef"
      class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(240px,var(--panel-first-width,320px))_minmax(420px,1fr)]"
      :style="{
        '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px`,
      }"
    >
      <aside
        ref="firstPanelRef"
        class="relative flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r"
      >
        <div class="flex flex-col gap-3 border-b border-border p-4">
          <div class="text-sm text-muted-foreground">{{ t('tools.pwd_box.search_label') }}</div>
          <input
            v-model="searchKeyword"
            data-testid="pwd-box-search-input"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            :placeholder="t('tools.pwd_box.search_placeholder')"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-3">
          <div
            v-if="loaded && items.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.pwd_box.empty_list') }}
          </div>

          <div
            v-else-if="loaded && visibleItems.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.pwd_box.empty_search') }}
          </div>

          <div v-else class="flex flex-col gap-3">
            <button
              v-for="item in visibleItems"
              :key="item.id"
              data-testid="pwd-box-list-item"
              type="button"
              class="w-full rounded-xl border p-3 text-left transition-colors"
              :class="
                selectedItemId === item.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'
              "
              @click="selectItem(item.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">
                    {{ item.site || t('tools.pwd_box.site_placeholder') }}
                  </div>
                  <div class="mt-1 truncate text-xs text-muted-foreground">
                    {{ item.username || t('tools.pwd_box.username_placeholder') }}
                  </div>
                  <div class="mt-2 text-xs text-muted-foreground">
                    {{ isPasswordVisible(item.id) ? item.password : maskPassword(item.password) }}
                  </div>
                  <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {{ item.note || t('tools.pwd_box.note_placeholder') }}
                  </p>
                </div>

                <button
                  data-testid="pwd-box-delete-button"
                  type="button"
                  class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  :title="t('tools.pwd_box.delete')"
                  @click.stop="deleteItem(item.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>

              <div class="mt-3 text-[11px] text-muted-foreground">
                {{ formatUpdatedAt(item.updatedAt) }}
              </div>
            </button>
          </div>
        </div>
        <div
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.pwd_box.resize_aria')"
          aria-orientation="vertical"
          :aria-valuenow="firstPanelWidth ?? firstPanelRef?.clientWidth ?? 240"
          tabindex="0"
          @pointerdown.prevent="startResize"
          @keydown="handleResizeKeydown"
        ></div>
      </aside>

      <section class="flex min-h-0 flex-col overflow-hidden">
        <div v-if="selectedItem" class="flex h-full min-h-0 flex-col gap-4 p-4">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="text-sm text-muted-foreground">{{ t('tools.pwd_box.site_label') }}</div>
              <input
                data-testid="pwd-box-site-input"
                :value="selectedItem.site"
                type="text"
                class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                :placeholder="t('tools.pwd_box.site_placeholder')"
                @input="patchSelectedItem({ site: ($event.target as HTMLInputElement).value })"
              />
            </div>

            <div class="flex flex-col gap-2">
              <div class="text-sm text-muted-foreground">
                {{ t('tools.pwd_box.username_label') }}
              </div>
              <input
                data-testid="pwd-box-username-input"
                :value="selectedItem.username"
                type="text"
                class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                :placeholder="t('tools.pwd_box.username_placeholder')"
                @input="patchSelectedItem({ username: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>

          <div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm text-muted-foreground">
                {{ t('tools.pwd_box.password_label') }}
              </div>
              <div class="flex items-center gap-2">
                <button
                  data-testid="pwd-box-toggle-visibility"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-foreground"
                  @click="toggleVisibility(selectedItem.id)"
                >
                  <EyeOff v-if="isPasswordVisible(selectedItem.id)" class="h-3.5 w-3.5" />
                  <Eye v-else class="h-3.5 w-3.5" />
                  {{
                    isPasswordVisible(selectedItem.id)
                      ? t('tools.pwd_box.hide_password')
                      : t('tools.pwd_box.show_password')
                  }}
                </button>
                <button
                  data-testid="pwd-box-copy-password"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-foreground"
                  @click="copyPassword"
                >
                  <Copy class="h-3.5 w-3.5" />
                  {{ t('tools.pwd_box.copy_password') }}
                </button>
              </div>
            </div>

            <div data-testid="pwd-box-password-display" class="text-sm font-medium text-foreground">
              {{
                isPasswordVisible(selectedItem.id)
                  ? selectedItem.password
                  : maskPassword(selectedItem.password)
              }}
            </div>

            <input
              data-testid="pwd-box-password-input"
              :value="selectedItem.password"
              :type="isPasswordVisible(selectedItem.id) ? 'text' : 'password'"
              class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              :placeholder="t('tools.pwd_box.password_placeholder')"
              @change="onPasswordInputChange($event, selectedItem)"
            />

            <div class="rounded-lg border border-border/80 bg-muted/20">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                :aria-expanded="generatorOpen"
                @click="generatorOpen = !generatorOpen"
              >
                <span class="inline-flex items-center gap-1.5">
                  <RefreshCw class="h-3.5 w-3.5" />
                  {{ t('tools.pwd_box.gen_toggle_panel') }}
                </span>
                <ChevronDown
                  class="h-3.5 w-3.5 transition-transform"
                  :class="generatorOpen ? 'rotate-180' : ''"
                />
              </button>

              <div v-if="generatorOpen" class="flex flex-col gap-3 border-t border-border/80 p-3">
                <div class="flex flex-col gap-2">
                  <div
                    class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span>{{ t('tools.pwd_box.gen_length') }}</span>
                    <span class="tabular-nums text-foreground">{{ genLength }}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <input
                      v-model.number="genLength"
                      data-testid="pwd-box-password-length"
                      type="range"
                      :min="MIN_PASSWORD_LENGTH"
                      :max="MAX_PASSWORD_LENGTH"
                      class="min-w-0 flex-1 accent-primary"
                      @input="onGenLengthInput(($event.target as HTMLInputElement).value)"
                    />
                    <input
                      v-model.number="genLength"
                      type="number"
                      :min="MIN_PASSWORD_LENGTH"
                      :max="MAX_PASSWORD_LENGTH"
                      class="w-16 rounded-md border border-border bg-background px-2 py-1 text-center text-xs outline-none focus:border-primary"
                      @change="onGenLengthInput(genLength)"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <label
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <input v-model="genUseUpper" type="checkbox" class="accent-primary" />
                    {{ t('tools.pwd_box.gen_use_upper') }}
                  </label>
                  <label
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <input v-model="genUseLower" type="checkbox" class="accent-primary" />
                    {{ t('tools.pwd_box.gen_use_lower') }}
                  </label>
                  <label
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <input v-model="genUseDigits" type="checkbox" class="accent-primary" />
                    {{ t('tools.pwd_box.gen_use_digits') }}
                  </label>
                  <label
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <input v-model="genUseSymbols" type="checkbox" class="accent-primary" />
                    {{ t('tools.pwd_box.gen_use_symbols') }}
                  </label>
                  <label
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 sm:col-span-2"
                  >
                    <input v-model="genExcludeAmbiguous" type="checkbox" class="accent-primary" />
                    {{ t('tools.pwd_box.gen_exclude_ambiguous') }}
                  </label>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    data-testid="pwd-box-generate-password"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    @click="runGeneratePassword"
                  >
                    <RefreshCw class="h-3.5 w-3.5" />
                    {{ t('tools.pwd_box.gen_generate') }}
                  </button>
                  <button
                    data-testid="pwd-box-fill-generated"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!generatedPassword"
                    @click="fillGeneratedPassword"
                  >
                    {{ t('tools.pwd_box.gen_fill') }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!generatedPassword"
                    @click="copyGeneratedPassword"
                  >
                    <Copy class="h-3.5 w-3.5" />
                    {{ t('tools.pwd_box.gen_copy') }}
                  </button>
                </div>

                <div
                  class="rounded-md border border-dashed border-border bg-background/80 px-3 py-2"
                >
                  <div
                    class="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span>{{ t('tools.pwd_box.gen_result') }}</span>
                    <span v-if="generatedStrength" class="inline-flex items-center gap-1">
                      {{ t('tools.pwd_box.gen_strength') }}:
                      <span :class="strengthToneClass[generatedStrength]">
                        {{ strengthLabel(generatedStrength) }}
                      </span>
                    </span>
                  </div>
                  <div class="break-all font-mono text-sm text-foreground">
                    {{ generatedPassword || t('tools.pwd_box.gen_empty_result') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-2">
            <div class="text-sm text-muted-foreground">{{ t('tools.pwd_box.note_label') }}</div>
            <textarea
              data-testid="pwd-box-note-input"
              :value="selectedItem.note"
              class="min-h-0 flex-1 resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none transition-colors focus:border-primary"
              :placeholder="t('tools.pwd_box.note_placeholder')"
              @input="patchSelectedItem({ note: ($event.target as HTMLTextAreaElement).value })"
            ></textarea>
          </div>
        </div>

        <div
          v-else
          class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
        >
          {{ t('tools.pwd_box.empty_detail') }}
        </div>
      </section>
    </div>
  </div>
</template>
