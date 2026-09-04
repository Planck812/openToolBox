<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';
import { RefreshCw, Search, Trash2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useEnvVars } from '@/composables/useEnvVars';
import {
  getPreviewActionLabel,
  getVariableSourceLabel,
  hasSameKeyForPlatform,
  hasSameWindowsKey,
} from './helpers';
import {
  type EnvPlatformInfo,
  type EnvTarget,
  type EnvVariableScope,
  type EnvWritePreview,
  type EnvVariable,
} from './env-shell';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const keyInput = ref('');
const valueInput = ref('');
const currentValue = ref<string | null>(null);
const currentValueKnown = ref(false);
const selectedScope = ref<EnvVariableScope | null>(null);
const selectedVariableKey = ref('');
const loading = ref(false);
const reading = ref(false);
const platformInfo = ref<EnvPlatformInfo | null>(null);
const platformLoading = ref(false);
const platformError = ref<string | null>(null);
const listLoading = ref(false);
const listLoaded = ref(false);
const listError = ref<string | null>(null);
const variables = ref<EnvVariable[]>([]);
const variableFilter = ref('');
const selectedTargetIds = ref<string[]>([]);
const targetError = ref<string | null>(null);
const writePreview = ref<EnvWritePreview | null>(null);
const applyingPreview = ref(false);
const deleting = ref(false);
const submitButton = ref<HTMLButtonElement | null>(null);
const cancelPreviewButton = ref<HTMLButtonElement | null>(null);
const scopeLabelKeys: Record<EnvVariableScope, string> = {
  user: 'tools.env_setter.scope_user',
  system: 'tools.env_setter.scope_system',
  process: 'tools.env_setter.scope_process',
  profile: 'tools.env_setter.scope_profile',
  bashrc: 'tools.env_setter.scope_bashrc',
  zshrc: 'tools.env_setter.scope_zshrc',
};

const hasSameKey = (left: string, right: string) => {
  const platform = platformInfo.value?.platform;
  return platform ? hasSameKeyForPlatform(platform, left, right) : left === right;
};

const isWindowsPlatform = computed(() => platformInfo.value?.platform === 'windows');

const isUnixPlatform = computed(() =>
  platformInfo.value?.platform === 'macos' || platformInfo.value?.platform === 'linux',
);

const hasSupportedPlatform = computed(() => isWindowsPlatform.value || isUnixPlatform.value);

const availableTargets = computed<EnvTarget[]>(() => platformInfo.value?.availableTargets ?? []);

// Send IDs in backend-provided order rather than checkbox toggle order.
const selectedUnixTargetIds = computed(() => {
  const selected = new Set(selectedTargetIds.value);
  return availableTargets.value
    .filter((target) => selected.has(target.id))
    .map((target) => target.id);
});

const selectedSystemVariable = computed(() =>
  selectedScope.value === 'system'
  && selectedVariableKey.value.length > 0
  && hasSameWindowsKey(keyInput.value.trim(), selectedVariableKey.value),
);

const canDeleteSelectedUserVariable = computed(() =>
  isWindowsPlatform.value
  && selectedScope.value === 'user'
  && selectedVariableKey.value.length > 0
  && hasSameWindowsKey(keyInput.value.trim(), selectedVariableKey.value),
);

const filteredVariables = computed(() => {
  const query = variableFilter.value.trim().toLocaleLowerCase();
  if (!query) return variables.value;

  return variables.value.filter((variable) =>
    `${variable.key}\n${variable.value}`.toLocaleLowerCase().includes(query),
  );
});

const { applyInitialData, loadPlatformInfo, loadVariables, selectVariable, onSubmit, deleteSelectedVariable, confirmPreview, readCurrentValue, closePreviewDialog, invalidatePreview, addWindowListeners, removeWindowListeners } = useEnvVars({
  keyInput, valueInput, currentValue, currentValueKnown, selectedScope, selectedVariableKey,
  loading, reading, platformInfo, platformLoading, platformError,
  listLoading, listLoaded, listError, variables,
  selectedTargetIds, targetError, writePreview, applyingPreview, deleting,
  submitButton, cancelPreviewButton,
  hasSupportedPlatform, isUnixPlatform, selectedUnixTargetIds, canDeleteSelectedUserVariable,
  store, nextTick,
});

/**
 * 从首页输入或剪贴板带入的内容预填 KEY / VALUE。
 */

watch(
  [keyInput, valueInput, () => selectedTargetIds.value.join('\x00')],
  () => {
    targetError.value = null;
    invalidatePreview();
  },
);

onActivated(() => {
  addWindowListeners();
});

onDeactivated(() => {
  removeWindowListeners();
});

onBeforeUnmount(() => {
  removeWindowListeners();
});

onMounted(() => {
  applyInitialData(props.initialData);
  addWindowListeners();
  void loadPlatformInfo();
  void loadVariables({ silent: true });
});

watch(
  () => props.initialData,
  (next) => {
    applyInitialData(next);
  },
);
</script>

<template>
  <div
    class="flex h-full flex-col gap-4 bg-background p-4 text-foreground"
    :data-env-platform="platformInfo?.platform ?? 'unknown'"
  >
    <div class="flex flex-col gap-1">
      <h1 class="text-lg font-medium">{{ t('tools.env_setter.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('tools.env_setter.description') }}</p>
    </div>

    <div
      v-if="platformLoading"
      data-testid="env-setter-platform-loading"
      class="text-xs text-muted-foreground"
    >
      {{ t('tools.env_setter.platform_loading') }}
    </div>
    <div
      v-else-if="platformError"
      data-testid="env-setter-platform-error"
      role="alert"
      class="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
    >
      <span>{{ t('tools.env_setter.platform_failed', { reason: platformError }) }}</span>
      <button
        data-testid="env-setter-platform-retry"
        type="button"
        class="ml-2 underline underline-offset-2"
        @click="loadPlatformInfo"
      >
        {{ t('tools.env_setter.list_retry') }}
      </button>
    </div>

    <div
      class="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
      data-testid="env-setter-hint"
    >
      {{ t('tools.env_setter.restart_hint') }}
    </div>

    <div class="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.35fr)]">
      <div class="grid content-start gap-4 overflow-auto pr-1">
        <label class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">{{ t('tools.env_setter.key_label') }}</span>
          <input
            v-model="keyInput"
            data-testid="env-setter-key-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            class="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm disabled:opacity-60"
            :disabled="applyingPreview || deleting || (isWindowsPlatform && loading)"
            :placeholder="t('tools.env_setter.key_placeholder')"
          />
          <span class="text-xs text-muted-foreground">{{ t('tools.env_setter.key_hint') }}</span>
        </label>

        <div
          v-if="selectedSystemVariable"
          data-testid="env-setter-system-override-hint"
          class="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
        >
          {{ t('tools.env_setter.system_override_hint') }}
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">{{ t('tools.env_setter.value_label') }}</span>
          <textarea
            v-model="valueInput"
            data-testid="env-setter-value-input"
            rows="4"
            spellcheck="false"
            class="resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm disabled:opacity-60"
            :disabled="applyingPreview || deleting || (isWindowsPlatform && loading)"
            :placeholder="t('tools.env_setter.value_placeholder')"
          />
          <span class="text-xs text-muted-foreground">{{ t('tools.env_setter.value_hint') }}</span>
        </label>

        <fieldset
          v-if="isUnixPlatform"
          data-testid="env-setter-target-selector"
          class="grid gap-2 rounded-md border border-border bg-muted/10 p-3"
          :disabled="loading || applyingPreview"
        >
          <legend class="px-1 text-sm font-medium">{{ t('tools.env_setter.target_title') }}</legend>
          <p class="text-xs text-muted-foreground">{{ t('tools.env_setter.target_hint') }}</p>
          <label
            v-for="target in availableTargets"
            :key="target.id"
            class="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 hover:bg-muted/60 has-[:disabled]:cursor-not-allowed"
          >
            <input
              v-model="selectedTargetIds"
              data-testid="env-setter-target-checkbox"
              type="checkbox"
              :value="target.id"
            />
            <span class="grid min-w-0 gap-1">
              <span class="break-all font-mono text-sm">{{ target.path }}</span>
              <span class="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                <span>{{ target.exists ? t('tools.env_setter.target_exists') : t('tools.env_setter.target_missing') }}</span>
                <span v-if="target.recommended" class="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                  {{ t('tools.env_setter.target_recommended') }}
                </span>
              </span>
            </span>
          </label>
          <div
            v-if="targetError"
            data-testid="env-setter-target-error"
            role="alert"
            class="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          >
            {{ targetError }}
          </div>
        </fieldset>

        <div class="flex flex-wrap items-center gap-2">
          <button
            ref="submitButton"
            data-testid="env-setter-submit-button"
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            :disabled="loading || reading || applyingPreview || deleting || !hasSupportedPlatform"
            @click="onSubmit"
          >
            {{ loading ? t('tools.env_setter.running') : t('tools.env_setter.submit') }}
          </button>
          <button
            data-testid="env-setter-read-button"
            type="button"
            class="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-60"
            :disabled="loading || reading || applyingPreview || deleting"
            @click="readCurrentValue()"
          >
            {{ reading ? t('tools.env_setter.reading') : t('tools.env_setter.read_current') }}
          </button>
          <button
            v-if="isWindowsPlatform"
            data-testid="env-setter-delete-button"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
            :disabled="!canDeleteSelectedUserVariable || loading || reading || applyingPreview || deleting"
            @click="deleteSelectedVariable"
          >
            <Trash2 class="h-4 w-4" />
            {{ deleting ? t('tools.env_setter.deleting') : t('tools.env_setter.delete') }}
          </button>
        </div>

        <div
          v-if="currentValueKnown"
          data-testid="env-setter-current-value"
          class="rounded-md border border-border bg-muted/20 p-3"
        >
          <div class="mb-1 text-sm font-medium text-muted-foreground">
            {{ t('tools.env_setter.current_value_title') }}
          </div>
          <pre
            v-if="currentValue !== null"
            class="whitespace-pre-wrap break-all font-mono text-sm"
          >{{ currentValue === '' ? t('tools.env_setter.current_value_empty') : currentValue }}</pre>
          <p v-else class="text-sm text-muted-foreground">
            {{ t('tools.env_setter.current_value_missing') }}
          </p>
        </div>
      </div>

      <section class="flex min-h-[18rem] flex-col overflow-hidden rounded-md border border-border bg-muted/10 md:min-h-0">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <div>
            <h2 class="text-sm font-medium">{{ t('tools.env_setter.list_title') }}</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ t('tools.env_setter.list_count', { count: variables.length }) }}
            </p>
          </div>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-initial">
            <label class="relative min-w-0 flex-1 sm:w-72 sm:flex-initial">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                v-model="variableFilter"
                data-testid="env-setter-list-filter"
                type="search"
                spellcheck="false"
                autocomplete="off"
                class="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
                :placeholder="t('tools.env_setter.list_filter_placeholder')"
              />
            </label>
            <button
              data-testid="env-setter-list-refresh"
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors hover:bg-muted disabled:opacity-60"
              :disabled="listLoading"
              @click="loadVariables()"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': listLoading }" />
              {{ t('tools.env_setter.list_refresh') }}
            </button>
          </div>
        </div>

        <div v-if="listError && !listLoaded" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p class="text-sm text-destructive">{{ t('tools.env_setter.list_failed', { reason: listError }) }}</p>
          <button
            data-testid="env-setter-list-retry"
            type="button"
            class="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            @click="loadVariables()"
          >
            {{ t('tools.env_setter.list_retry') }}
          </button>
        </div>
        <div v-else-if="listLoading && !listLoaded" class="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {{ t('tools.env_setter.list_loading') }}
        </div>
        <div
          v-else-if="!filteredVariables.length"
          data-testid="env-setter-list-empty"
          class="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
        >
          {{ variableFilter ? t('tools.env_setter.list_no_matches') : t('tools.env_setter.list_empty') }}
        </div>
        <div v-else class="min-h-0 flex-1 overflow-auto">
          <table data-testid="env-setter-variable-table" class="w-full table-fixed border-collapse text-left text-sm">
            <thead class="sticky top-0 z-10 bg-background">
              <tr class="border-b border-border text-xs text-muted-foreground">
                <th class="w-[40%] px-3 py-2 font-medium">{{ t('tools.env_setter.list_key') }}</th>
                <th class="w-16 px-2 py-2 font-medium">{{ t('tools.env_setter.list_scope') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('tools.env_setter.list_value') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(variable, index) in filteredVariables"
                :key="`${variable.scope}:${variable.key}:${index}`"
                data-testid="env-setter-variable-row"
                class="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-muted/60 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/50"
                :class="{ 'bg-primary/5': hasSameKey(keyInput, variable.key) && selectedScope === variable.scope }"
                tabindex="0"
                @click="selectVariable(variable)"
                @keydown.enter="selectVariable(variable)"
                @keydown.space.prevent="selectVariable(variable)"
              >
                <td class="truncate px-3 py-2.5 font-mono font-medium" :title="variable.key">
                  {{ variable.key }}
                </td>
                <td class="px-2 py-2.5">
                  <span
                    class="inline-block rounded px-1.5 py-0.5 font-mono text-[10px] leading-tight"
                    :class="variable.scope === 'user'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'"
                  >
                    {{ getVariableSourceLabel(variable, t, scopeLabelKeys) }}
                  </span>
                </td>
                <td class="truncate px-3 py-2.5 font-mono text-muted-foreground" :title="variable.value">
                  {{ variable.value || t('tools.env_setter.current_value_empty') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div
      v-if="writePreview"
      data-testid="env-setter-preview-overlay"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="!applyingPreview && closePreviewDialog()"
    >
      <section
        data-testid="env-setter-preview-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="env-setter-preview-title"
        class="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-xl"
        @click.stop
      >
        <div class="border-b border-border px-4 py-3">
          <h2 id="env-setter-preview-title" class="text-base font-semibold">
            {{ t('tools.env_setter.preview_title') }}
          </h2>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <section v-if="writePreview.warnings.length" class="rounded-md border border-border bg-muted/20 p-3">
            <h3 class="text-sm font-medium">{{ t('tools.env_setter.preview_warnings') }}</h3>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li v-for="warning in writePreview.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </section>

          <section
            v-for="target in writePreview.targets"
            :key="target.id"
            data-testid="env-setter-preview-target"
            class="space-y-3 rounded-md border border-border p-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="break-all font-mono text-sm">{{ target.path }}</p>
              <span class="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {{ getPreviewActionLabel(target.action, t) }}
              </span>
            </div>
            <div v-if="target.warnings.length" class="rounded bg-muted/50 p-2">
              <h3 class="text-xs font-medium">{{ t('tools.env_setter.preview_warnings') }}</h3>
              <ul class="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li v-for="warning in target.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>
            <div>
              <h3 class="mb-1 text-xs font-medium text-muted-foreground">{{ t('tools.env_setter.preview_diff') }}</h3>
              <pre
                :data-testid="`env-setter-preview-target-diff-${target.id}`"
                class="overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-2 font-mono text-xs"
              >{{ target.diff }}</pre>
            </div>
          </section>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            ref="cancelPreviewButton"
            data-testid="env-setter-preview-cancel"
            type="button"
            class="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
            :disabled="applyingPreview || deleting || (isWindowsPlatform && loading)"
            @click="closePreviewDialog()"
          >
            {{ t('tools.env_setter.preview_cancel') }}
          </button>
          <button
            data-testid="env-setter-preview-confirm"
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            :disabled="applyingPreview || deleting || (isWindowsPlatform && loading)"
            @click="confirmPreview"
          >
            {{ applyingPreview ? t('tools.env_setter.preview_applying') : t('tools.env_setter.preview_confirm') }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
