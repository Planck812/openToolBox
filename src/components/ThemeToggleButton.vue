<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { Moon, Sun } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';

const store = useAppStore();
const { themeMode } = storeToRefs(store);
const { t } = useI18n();

const isDark = computed(() => themeMode.value === 'dark');
const label = computed(() => t(isDark.value ? 'common.switch_to_light' : 'common.switch_to_dark'));

const handleToggleTheme = () => {
  store.toggleThemeMode();
};
</script>

<template>
  <button
    data-testid="theme-toggle"
    type="button"
    class="theme-toggle group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 backdrop-blur-xl transition-all hover:-translate-y-0.5 focus-visible:outline-none"
    :aria-label="label"
    :title="label"
    @click="handleToggleTheme"
  >
    <span
      class="theme-toggle-thumb flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-transform duration-300"
      :class="{ 'translate-x-5': isDark }"
    >
      <Sun v-if="isDark" class="h-4 w-4" />
      <Moon v-else class="h-4 w-4" />
    </span>
  </button>
</template>

<style scoped>
.theme-toggle {
  border: 1px solid rgba(var(--skin-accent-rgb) / 0.2);
  background: var(--skin-glass-bg);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.theme-toggle:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  box-shadow: 0 6px 20px rgba(var(--skin-accent-rgb) / 0.25), 0 0 12px rgba(var(--skin-accent-rgb) / 0.2);
}

.theme-toggle:focus-visible {
  box-shadow:
    0 0 0 2px rgba(var(--skin-accent-rgb) / 0.3),
    0 0 16px rgba(var(--skin-accent-rgb) / 0.3);
}

.theme-toggle-thumb {
  background: linear-gradient(135deg, var(--skin-accent-3), var(--skin-accent));
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

:global(html.dark) .theme-toggle {
  background: var(--skin-glass-bg);
  border-color: rgba(var(--skin-accent-rgb) / 0.25);
  box-shadow:
    0 0 18px rgba(var(--skin-accent-rgb) / 0.2),
    0 4px 14px rgba(0, 0, 0, 0.3);
}

:global(html.dark) .theme-toggle-thumb {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2));
  color: #04111d;
  box-shadow: 0 0 16px rgba(var(--skin-accent-rgb) / 0.5), 0 0 4px rgba(var(--skin-accent-rgb) / 0.6);
}
</style>
