<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import i18n from '@/i18n';
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ChevronRight } from 'lucide-vue-next';
import { THEME_SKINS, getThemeSkin, type ThemeSkinId } from '@/lib/theme';
import ShortcutRow from '@/components/ShortcutRow.vue';
import ToolShortcutsPanel from '@/components/ToolShortcutsPanel.vue';
import PipelineShortcutsPanel from '@/components/PipelineShortcutsPanel.vue';


const router = useRouter();
const route = useRoute();
const store = useAppStore();
const { homeShortcut, showShortcut, universalScreenshotShortcut, stickyShortcut, singleStickyShortcut, pinRecoveryShortcut, themeMode, themeSkinId, appBackgroundMode, homeMotionEnabled } = storeToRefs(store);
const { t } = useI18n();

type SettingNavId =
  | 'theme' | 'background' | 'motion' | 'language'
  | 'shortcut-home' | 'shortcut-show' | 'shortcut-screenshot' | 'shortcut-sticky'
  | 'shortcut-single-sticky' | 'shortcut-pin-recovery'
  | 'shortcut-tools' | 'shortcut-pipelines';

interface NavGroup {
  groupKey: string;
  children: { id: SettingNavId; labelKey: string }[];
}

const navItems: NavGroup[] = [
  { groupKey: 'settings.nav_group_appearance', children: [
    { id: 'theme', labelKey: 'settings.section_theme' },
    { id: 'background', labelKey: 'settings.section_background' },
    { id: 'motion', labelKey: 'settings.section_motion' },
    { id: 'language', labelKey: 'settings.section_language' },
  ]},
  { groupKey: 'settings.nav_group_shortcuts', children: [
    { id: 'shortcut-home', labelKey: 'common.home_shortcut_label' },
    { id: 'shortcut-show', labelKey: 'common.show_shortcut_label' },
    { id: 'shortcut-screenshot', labelKey: 'common.universal_screenshot_shortcut_label' },
    { id: 'shortcut-sticky', labelKey: 'common.sticky_shortcut_label' },
    { id: 'shortcut-single-sticky', labelKey: 'common.single_sticky_shortcut_label' },
    { id: 'shortcut-pin-recovery', labelKey: 'common.pin_recovery_shortcut_label' },
    { id: 'shortcut-tools', labelKey: 'common.tool_shortcuts_label' },
    { id: 'shortcut-pipelines', labelKey: 'common.pipeline_shortcuts_label' },
  ]},
];

const allNavIds = navItems.flatMap((group) => group.children.map((child) => child.id));

/**
 * 读取 ?section= 参数；route.query.section 可能是 string | string[]，统一取首个有效字符串。
 */
const readSectionQuery = (): string | undefined => {
  const section = route.query.section;
  const raw = Array.isArray(section) ? section[0] : section;
  return typeof raw === 'string' ? raw : undefined;
};

const activeId = ref<SettingNavId>(resolveActiveId(readSectionQuery()));

// 折叠的组 key 集合（默认全展开）。点击组标题切换。
const collapsedGroups = ref<Set<string>>(new Set());

/**
 * 切换某个导航分组的折叠/展开
 * @param groupKey 组 i18n key
 */
const toggleGroup = (groupKey: string) => {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupKey)) next.delete(groupKey);
  else next.add(groupKey);
  collapsedGroups.value = next;
};

// 外部（如托盘「设置快捷键」）通过 ?section=<id> 直达指定区块；已停留在设置页时也要跟随切换
watch(
  () => route.query.section,
  () => {
    activeId.value = resolveActiveId(readSectionQuery());
  }
);

/**
 * 仅允许导航树内合法的区块 id；否则回退到默认「界面换肤」
 * @param section 外部传入的目标区块 id
 */
function resolveActiveId(section?: string): SettingNavId {
  if (section && allNavIds.includes(section as SettingNavId)) return section as SettingNavId;
  return 'theme';
}

interface ShortcutConfig {
  id: SettingNavId;
  labelKey: string;
  hintKey: string;
  placeholderKey: string;
  saveLabelKey: string;
  resetLabelKey: string;
  setter: (value: string) => void;
  resetter: () => void;
  saveToastKey: string;
  resetToastKey: string;
  shortcutRef: Ref<string>;
}

const shortcutConfigs: ShortcutConfig[] = [
  {
    id: 'shortcut-home',
    labelKey: 'common.home_shortcut_label',
    hintKey: 'common.home_shortcut_help',
    placeholderKey: 'common.home_shortcut_placeholder',
    saveLabelKey: 'common.home_shortcut_save',
    resetLabelKey: 'common.home_shortcut_reset',
    setter: store.setHomeShortcut,
    resetter: store.resetHomeShortcut,
    saveToastKey: 'common.home_shortcut_saved',
    resetToastKey: 'common.home_shortcut_reset_done',
    shortcutRef: homeShortcut,
  },
  {
    id: 'shortcut-show',
    labelKey: 'common.show_shortcut_label',
    hintKey: 'common.show_shortcut_help',
    placeholderKey: 'common.show_shortcut_placeholder',
    saveLabelKey: 'common.home_shortcut_save',
    resetLabelKey: 'common.home_shortcut_reset',
    setter: store.setShowShortcut,
    resetter: store.resetShowShortcut,
    saveToastKey: 'common.show_shortcut_saved',
    resetToastKey: 'common.show_shortcut_reset_done',
    shortcutRef: showShortcut,
  },
  {
    id: 'shortcut-screenshot',
    labelKey: 'common.universal_screenshot_shortcut_label',
    hintKey: 'common.universal_screenshot_shortcut_help',
    placeholderKey: 'common.universal_screenshot_shortcut_placeholder',
    saveLabelKey: 'common.screenshot_shortcut_save',
    resetLabelKey: 'common.screenshot_shortcut_reset',
    setter: store.setUniversalScreenshotShortcut,
    resetter: store.resetUniversalScreenshotShortcut,
    saveToastKey: 'common.screenshot_shortcut_saved',
    resetToastKey: 'common.screenshot_shortcut_reset_done',
    shortcutRef: universalScreenshotShortcut,
  },
  {
    id: 'shortcut-sticky',
    labelKey: 'common.sticky_shortcut_label',
    hintKey: 'common.sticky_shortcut_help',
    placeholderKey: 'common.sticky_shortcut_placeholder',
    saveLabelKey: 'common.screenshot_shortcut_save',
    resetLabelKey: 'common.screenshot_shortcut_reset',
    setter: store.setStickyShortcut,
    resetter: store.resetStickyShortcut,
    saveToastKey: 'common.sticky_shortcut_saved',
    resetToastKey: 'common.sticky_shortcut_reset_done',
    shortcutRef: stickyShortcut,
  },
  {
    id: 'shortcut-single-sticky',
    labelKey: 'common.single_sticky_shortcut_label',
    hintKey: 'common.single_sticky_shortcut_help',
    placeholderKey: 'common.single_sticky_shortcut_placeholder',
    saveLabelKey: 'common.single_sticky_shortcut_save',
    resetLabelKey: 'common.single_sticky_shortcut_reset',
    setter: store.setSingleStickyShortcut,
    resetter: store.resetSingleStickyShortcut,
    saveToastKey: 'common.single_sticky_shortcut_saved',
    resetToastKey: 'common.single_sticky_shortcut_reset_done',
    shortcutRef: singleStickyShortcut,
  },
  {
    id: 'shortcut-pin-recovery',
    labelKey: 'common.pin_recovery_shortcut_label',
    hintKey: 'common.pin_recovery_shortcut_help',
    placeholderKey: 'common.pin_recovery_shortcut_placeholder',
    saveLabelKey: 'common.pin_recovery_shortcut_save',
    resetLabelKey: 'common.pin_recovery_shortcut_reset',
    setter: store.setPinRecoveryShortcut,
    resetter: store.resetPinRecoveryShortcut,
    saveToastKey: 'common.pin_recovery_shortcut_saved',
    resetToastKey: 'common.pin_recovery_shortcut_reset_done',
    shortcutRef: pinRecoveryShortcut,
  },
];

const isShortcutSection = computed(() => shortcutConfigs.some((config) => config.id === activeId.value));

const activeShortcutConfig = computed<ShortcutConfig>(
  () => shortcutConfigs.find((config) => config.id === activeId.value) ?? shortcutConfigs[0],
);

/**
 * 保存快捷键：写 store、提示成功后跳回首页。
 * @param config 目标快捷键配置
 * @param value 由 ShortcutRow 提交的草稿值
 */
const saveShortcut = async (config: ShortcutConfig, value: string) => {
  config.setter(value);
  store.showToast(t(config.saveToastKey, { shortcut: config.shortcutRef.value }), { type: 'success' });
  await router.push('/');
};

/**
 * 恢复默认快捷键并提示。
 * @param config 目标快捷键配置
 */
const resetShortcut = (config: ShortcutConfig) => {
  config.resetter();
  store.showToast(t(config.resetToastKey, { shortcut: config.shortcutRef.value }), { type: 'success' });
};

/** i18n 已注册的语言，与 src/i18n.ts 的 messages 键一致。 */
type AppLocale = 'zh-CN' | 'en-US';

const languages: { code: AppLocale; name: string }[] = [
  { code: 'zh-CN', name: '中文' },
  { code: 'en-US', name: 'English' },
];

const currentLocale = ref<string>(i18n.global.locale.value as string);

const changeLanguage = (locale: AppLocale) => {
  i18n.global.locale.value = locale;
  currentLocale.value = locale;
  localStorage.setItem('app-locale', locale);
};

const activeThemeSkin = computed(() => getThemeSkin(themeSkinId.value));
const isDarkSkin = (skinId: ThemeSkinId) => getThemeSkin(skinId).recommendedMode === 'dark';
const isDarkThemeList = computed(() => activeThemeSkin.value.recommendedMode === 'dark' && themeMode.value === 'dark');
const isDarkPreview = () => isDarkThemeList.value;
const isLightListWithDarkSkin = (skinId: ThemeSkinId) => !isDarkThemeList.value && isDarkSkin(skinId);

/**
 * 将 16 进制颜色转换为 RGB 三元组；解析失败返回 null
 */
const hexToRgb = (hex: string): [number, number, number] | null => {
  const normalized = hex.trim().replace('#', '');
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(normalized)) return null;
  const full = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
};

/**
 * 生成带透明度的 rgb 颜色；失败时回退到指定默认值
 */
const withAlpha = (color: string, alpha: number, fallback: string) => {
  const rgb = hexToRgb(color);
  if (!rgb) return fallback;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
};

const previewShellStyle = (skin: (typeof THEME_SKINS)[number]) => {
  if (!isDarkThemeList.value) return {};
  return {
    borderColor: withAlpha(skin.accent, 0.22, 'rgba(148,163,184,0.22)'),
    background: `linear-gradient(145deg, ${withAlpha(skin.accent, 0.12, 'rgba(59,130,246,0.12)')} 0%, rgba(5,18,43,0.94) 56%, rgba(3,11,30,0.98) 100%)`
  };
};

const previewSidebarStyle = (skin: (typeof THEME_SKINS)[number]) => {
  if (!isDarkThemeList.value) {
    if (isLightListWithDarkSkin(skin.id)) {
      return { background: '#EAF1F8' };
    }
    return { background: skin.panel };
  }
  return {
    background: `linear-gradient(180deg, ${withAlpha(skin.accent, 0.2, 'rgba(59,130,246,0.2)')} 0%, rgba(11,27,56,0.92) 100%)`
  };
};

const previewContentStyle = (skin: (typeof THEME_SKINS)[number]) => {
  if (!isDarkThemeList.value) {
    if (isLightListWithDarkSkin(skin.id)) {
      return { background: '#F8FBFF' };
    }
    return { background: skin.background };
  }
  return {
    background: `linear-gradient(165deg, rgba(17,34,66,0.92) 0%, ${withAlpha(skin.accent2, 0.08, 'rgba(96,165,250,0.08)')} 100%)`
  };
};

const goBack = () => {
  router.push('/');
};

/** 背景图体积上限（2MB）：base64 写入 localStorage 需稳定落在配额内，避免超限被静默吞掉。 */
const MAX_BACKGROUND_IMAGE_BYTES = 2 * 1024 * 1024;

const handleBackgroundFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    store.showToast(t('settings.toast_select_image'), { type: 'warning' });
    return;
  }

  if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
    store.showToast(t('settings.toast_image_too_large'), { type: 'warning' });
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    if (!result) {
      store.showToast(t('settings.toast_read_failed'), { type: 'error' });
      return;
    }
    store.setAppBackgroundImage(result);
    store.setAppBackgroundMode('custom');
    store.showToast(t('settings.toast_background_updated'), { type: 'success' });
  };
  reader.onerror = () => {
    store.showToast(t('settings.toast_read_failed'), { type: 'error' });
  };
  reader.readAsDataURL(file);
  if (input) input.value = '';
};

const clearBackgroundImage = () => {
  store.setAppBackgroundImage('');
  store.setAppBackgroundMode('default');
  store.showToast(t('settings.toast_background_reset'), { type: 'success' });
};

const disableBackgroundImage = () => {
  store.setAppBackgroundMode('none');
  store.showToast(t('settings.toast_background_disabled'), { type: 'success' });
};
</script>

<template>
  <div class="settings-page flex h-full flex-col">
    <div class="settings-header p-4 flex items-center gap-3 shrink-0">
      <button class="settings-back-btn p-2 rounded-full transition-colors" @click="goBack">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <h1 class="text-lg font-bold settings-title">{{ t('common.settings_title') }}</h1>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <nav class="settings-nav w-52 shrink-0 border-r overflow-auto">
        <div v-for="group in navItems" :key="group.groupKey" class="settings-nav-group">
          <button
            type="button"
            class="settings-nav-group-title"
            :aria-expanded="!collapsedGroups.has(group.groupKey)"
            @click="toggleGroup(group.groupKey)"
          >
            <ChevronRight class="settings-nav-chevron" :class="{ 'is-collapsed': collapsedGroups.has(group.groupKey) }" />
            <span>{{ t(group.groupKey) }}</span>
          </button>
          <button
            v-for="item in group.children"
            v-show="!collapsedGroups.has(group.groupKey)"
            :key="item.id"
            type="button"
            class="settings-nav-item"
            :class="{ 'is-active': activeId === item.id }"
            @click="activeId = item.id"
          >
            {{ t(item.labelKey) }}
          </button>
        </div>
      </nav>

      <div class="flex-1 overflow-auto p-4">
        <div class="max-w-[980px]">
          <section v-if="activeId === 'theme'">
            <div class="settings-section-title">{{ t('settings.section_theme') }}</div>
            <div class="settings-section-hint">{{ t('settings.section_theme_hint') }}</div>

            <div
              class="mb-4 rounded-2xl px-4 py-3 transition-all settings-summary"
              :class="isDarkThemeList ? 'is-dark' : ''"
            >
              <div class="text-sm font-semibold settings-summary-title">{{ t(activeThemeSkin.name) }}</div>
              <div class="mt-1 text-xs settings-summary-hint">{{ t(activeThemeSkin.description) }} {{ t('settings.theme_summary_mode', { mode: t(themeMode === 'dark' ? 'settings.theme_mode_dark' : 'settings.theme_mode_light') }) }}</div>
            </div>

            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" :class="isDarkThemeList ? 'theme-grid--dark' : ''">
              <button
                v-for="skin in THEME_SKINS"
                :key="skin.id"
                type="button"
                class="theme-skin-card rounded-[20px] p-4 text-left transition-all"
                :class="[themeSkinId === skin.id ? 'is-active' : '', isDarkThemeList ? 'is-dark-list' : '']"
                @click="store.setThemeSkin(skin.id)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold skin-name">{{ t(skin.name) }}</div>
                    <div class="mt-1 text-xs skin-desc" :class="isDarkThemeList ? 'dark-mode' : isDarkSkin(skin.id) ? 'dark-skin-light-list' : ''">
                      {{ t(skin.description) }}
                    </div>
                  </div>
                  <span
                    class="rounded-full border px-2 py-1 text-[11px] font-semibold skin-badge"
                    :class="
                      isDarkThemeList
                        ? 'is-dark'
                        : isDarkSkin(skin.id)
                          ? 'is-dark-skin-light'
                          : ''
                    "
                  >
                    {{ t(skin.recommendedMode === 'dark' ? 'settings.theme_skin_dark' : 'settings.theme_skin_light') }}
                  </span>
                </div>

                <div class="mt-4 flex gap-2">
                  <span class="theme-swatch" :style="{ background: skin.accent }"></span>
                  <span class="theme-swatch" :style="{ background: skin.accent2 }"></span>
                  <span class="theme-swatch" :style="{ background: skin.accent3 }"></span>
                  <span class="theme-swatch" :style="{ background: skin.panel }"></span>
                </div>

                <div
                  class="mt-4 overflow-hidden rounded-2xl border skin-preview"
                  :class="isDarkPreview() ? 'is-dark-preview' : ''"
                  :style="previewShellStyle(skin)"
                >
                  <div class="flex h-24">
                    <div
                      class="w-16 border-r px-2 py-2"
                      :class="isDarkPreview() ? 'is-dark-preview' : ''"
                      :style="previewSidebarStyle(skin)"
                    >
                      <div class="mb-2 h-2 rounded-full opacity-90" :style="{ background: skin.accent }"></div>
                      <div class="mb-1 h-2 rounded-full opacity-90 preview-line" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                      <div class="h-2 rounded-full opacity-80 preview-line" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                    </div>
                    <div class="flex-1 px-3 py-3" :style="previewContentStyle(skin)">
                      <div class="h-3 w-24 rounded-full preview-title-line" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                      <div class="mt-3 flex gap-2">
                        <div class="h-8 flex-1 rounded-xl shadow-sm preview-card" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                        <div class="h-8 w-8 rounded-full shadow-sm" :style="{ background: skin.accent }"></div>
                      </div>
                      <div class="mt-3 grid grid-cols-3 gap-2">
                        <div class="h-6 rounded-lg shadow-sm preview-card" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                        <div class="h-6 rounded-lg shadow-sm preview-card" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                        <div class="h-6 rounded-lg shadow-sm preview-card" :class="isDarkPreview() ? 'is-dark-preview' : ''"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </section>

          <section v-else-if="activeId === 'motion'">
            <div class="settings-section-title">{{ t('settings.section_motion') }}</div>
            <div class="settings-section-hint">{{ t('settings.section_motion_hint') }}</div>
            <label class="inline-flex cursor-pointer items-center gap-3 text-sm">
              <input
                :checked="homeMotionEnabled"
                type="checkbox"
                class="h-4 w-4 accent-primary"
                @change="store.setHomeMotionEnabled(($event.target as HTMLInputElement).checked)"
              />
              {{ t('settings.enable_home_motion') }}
            </label>
          </section>

          <section v-else-if="activeId === 'language'">
            <div class="settings-section-title">{{ t('settings.section_language') }}</div>
            <div class="flex flex-col gap-2">
              <button
                v-for="lang in languages"
                :key="lang.code"
                :class="{
                  'is-active': currentLocale === lang.code,
                }"
                class="settings-btn text-left"
                @click="changeLanguage(lang.code)"
              >
                <div class="font-medium">{{ lang.name }}</div>
                <div class="text-xs opacity-60">{{ lang.code }}</div>
              </button>
            </div>
          </section>

          <section v-else-if="activeId === 'background'">
            <div class="settings-section-title">{{ t('settings.section_background') }}</div>
            <div class="settings-section-hint">{{ t('settings.section_background_hint') }}</div>
            <div class="flex items-center gap-2 flex-wrap">
              <label class="settings-btn cursor-pointer">
                {{ t('settings.upload_background') }}
                <input
                  type="file"
                  accept="image/*"
                  class="sr-only"
                  :aria-label="t('settings.upload_background')"
                  @change="handleBackgroundFileChange"
                />
              </label>
              <button
                class="settings-btn"
                :disabled="appBackgroundMode === 'default'"
                :class="{ 'is-disabled': appBackgroundMode === 'default' }"
                @click="clearBackgroundImage"
              >
                {{ t('settings.default_background') }}
              </button>
              <button
                class="settings-btn"
                :disabled="appBackgroundMode === 'none'"
                :class="{ 'is-disabled': appBackgroundMode === 'none' }"
                @click="disableBackgroundImage"
              >
                {{ t('settings.no_background') }}
              </button>
            </div>
          </section>

          <ShortcutRow
            v-else-if="isShortcutSection"
            :label-key="activeShortcutConfig.labelKey"
            :hint-key="activeShortcutConfig.hintKey"
            :placeholder-key="activeShortcutConfig.placeholderKey"
            :save-label-key="activeShortcutConfig.saveLabelKey"
            :reset-label-key="activeShortcutConfig.resetLabelKey"
            :model-value="activeShortcutConfig.shortcutRef.value"
            :on-save="(value: string) => saveShortcut(activeShortcutConfig, value)"
            :on-reset="() => resetShortcut(activeShortcutConfig)"
          />

          <ToolShortcutsPanel v-else-if="activeId === 'shortcut-tools'" />

          <PipelineShortcutsPanel v-else-if="activeId === 'shortcut-pipelines'" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  color: var(--skin-text-main);
  background: transparent;
}

.settings-header {
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  position: relative;
}

.settings-back-btn {
  color: var(--skin-text-muted);
  transition: all 0.2s ease;
}

.settings-back-btn:hover {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.1);
}

.settings-title {
  color: var(--skin-text-strong);
}

.settings-nav-group {
  padding: 16px 12px 4px;
}

.settings-nav-group-title {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 4px;
  margin-bottom: 6px;
  color: var(--skin-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.settings-nav-group-title:hover {
  color: var(--skin-text-main);
}

.settings-nav-chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 0.18s ease;
  color: var(--skin-text-muted);
}

.settings-nav-chevron.is-collapsed {
  transform: rotate(90deg);
}

.settings-nav-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  text-align: left;
  font-size: 13px;
  color: var(--skin-text-main);
  border-left: 2px solid transparent;
  transition: all 0.2s ease;
}

.settings-nav-item:hover {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.08);
}

.settings-nav-item.is-active {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.1);
  border-left-color: var(--skin-accent);
  box-shadow: 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.08), 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.settings-nav-group + .settings-nav-group {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--skin-border);
}

.settings-section-title {
  color: var(--skin-text-strong);
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  position: relative;
  padding-left: 14px;
}

.settings-section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--skin-accent), var(--skin-accent-2));
  box-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.5);
}

.settings-section-hint {
  color: var(--skin-text-muted);
  font-size: 12px;
  margin-bottom: 16px;
}

.settings-summary {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft);
}

.settings-summary.is-dark {
  border-color: rgba(var(--skin-accent-rgb) / 0.3);
  background:
    radial-gradient(120% 120% at 10% 0%, rgba(var(--skin-accent-rgb) / 0.15) 0%, var(--skin-panel-bg) 42%, var(--skin-panel-bg) 100%);
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.1), var(--skin-glow);
}

.settings-summary-title {
  color: var(--skin-text-strong);
}

.settings-summary-hint {
  color: var(--skin-text-muted);
}

.theme-grid--dark .theme-skin-card {
  border-color: rgba(var(--skin-accent-rgb) / 0.15);
  background:
    radial-gradient(130% 120% at 0% 0%, rgba(var(--skin-accent-rgb) / 0.12) 0%, var(--skin-panel-bg) 45%, var(--skin-panel-bg) 100%);
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.08), var(--skin-glow-soft);
}

.theme-skin-card {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.theme-skin-card:hover {
  transform: translateY(-2px);
  border-color: rgba(var(--skin-accent-rgb) / 0.3);
  box-shadow: var(--skin-glow);
}

.theme-skin-card.is-active {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  box-shadow: 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.2), var(--skin-glow), 0 0 20px rgba(var(--skin-accent-rgb) / 0.15);
}

.theme-grid--dark .theme-skin-card.is-active {
  border-color: rgba(var(--skin-accent-rgb) / 0.6);
  box-shadow: 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.3), var(--skin-glow), 0 0 28px rgba(var(--skin-accent-rgb) / 0.2);
}

.skin-name {
  color: var(--skin-text-strong);
}

.skin-desc {
  color: var(--skin-text-muted);
}

.skin-desc.dark-mode {
  color: rgba(226, 232, 240, 0.85);
}

.skin-desc.dark-skin-light-list {
  color: var(--skin-text-subtle);
}

.skin-badge {
  border-color: var(--skin-border);
  color: var(--skin-text-muted);
}

.skin-badge.is-dark {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(15, 23, 42, 0.4);
  color: rgba(226, 232, 240, 0.9);
}

.skin-badge.is-dark-skin-light {
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(203, 213, 225, 0.9);
}

.theme-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 0 8px rgba(0, 0, 0, 0.1);
}

.theme-grid--dark .theme-swatch {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.3);
}

.skin-preview {
  border-color: var(--skin-border);
}

.skin-preview.is-dark-preview {
  border-color: rgba(255, 255, 255, 0.08);
}

.preview-line {
  background: rgba(255, 255, 255, 0.7);
}

.preview-line.is-dark-preview {
  background: rgba(255, 255, 255, 0.85);
}

.preview-title-line {
  background: rgba(15, 23, 42, 0.9);
}

.preview-title-line.is-dark-preview {
  background: rgba(255, 255, 255, 0.25);
}

.preview-card {
  background: rgba(255, 255, 255, 0.9);
}

.preview-card.is-dark-preview {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-btn {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-main);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.settings-btn:hover:not(.is-disabled) {
  border-color: var(--skin-accent);
  color: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.15);
}

.settings-btn.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
