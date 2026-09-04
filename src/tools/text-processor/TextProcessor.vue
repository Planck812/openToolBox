<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { copyText } from '@/lib/clipboard';
import {
  runPipeline,
  type PipelineStep,
  type StepDeps,
  type StepOp,
  type StepScope,
  type StatsReport,
} from './steps';
import {
  STEP_CATEGORIES,
  STEP_DEFAULT_PARAMS,
  STEP_PARAM_FIELDS,
  type StepDefinition,
  type StepParamField,
} from './index';
import { digestText } from '../hash-tool/runtime';
import {
  deletePipeline,
  loadPipelines,
  savePipeline,
  type SavedPipeline,
} from './pipeline-store';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FolderOpen,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-vue-next';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

// ---------- State ----------
const inputText = ref('');
const outputText = ref('');
const statsReport = ref<StatsReport | null>(null);
const autoCopy = ref(true);
const isRunning = ref(false);

const steps = ref<PipelineStep[]>([]);
const pipelineName = ref('');
const savedPipelines = ref<SavedPipeline[]>([]);
const selectedLoadName = ref('');

const addCategoryValue = ref<string>(STEP_CATEGORIES[0].value);
const addOpValue = ref<string>(STEP_CATEGORIES[0].items[0].op);

const {
  containerRef,
  firstPanelRef,
  firstPanelWidth,
  startResize,
  handleResizeKeydown,
} = useResizablePanel({ minFirstWidth: 280, minSecondWidth: 320 });

// hash 步骤依赖注入：适配 StepDeps（algorithm 为 string）与 hash-tool 的 HashAlgorithm。
const pipelineDeps: StepDeps = {
  digestText: digestText as (algorithm: string, text: string) => Promise<string>,
};

// ---------- Helpers ----------
const genId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const stepDef = (op: StepOp): StepDefinition | undefined => {
  for (const cat of STEP_CATEGORIES) {
    const found = cat.items.find((item) => item.op === op);
    if (found) {
      return found;
    }
  }
  return undefined;
};

const stepLabel = (op: StepOp): string =>
  t(`tools.text_processor.type_${stepDef(op)?.label ?? op}`);

const fieldsFor = (op: StepOp): StepParamField[] => STEP_PARAM_FIELDS[op] ?? [];

const displayChar = (ch: string): string =>
  ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' ? '␣' : ch;

const currentCategoryItems = computed(() => {
  const cat = STEP_CATEGORIES.find((c) => c.value === addCategoryValue.value);
  return cat ? cat.items : [];
});

const hasStatsStep = computed(() => steps.value.some((s) => s.op === 'stats'));

watch(addCategoryValue, () => {
  const cat = STEP_CATEGORIES.find((c) => c.value === addCategoryValue.value);
  if (cat && cat.items.length > 0) {
    const exists = cat.items.some((item) => item.op === addOpValue.value);
    if (!exists) {
      addOpValue.value = cat.items[0].op;
    }
  }
});

// ---------- Step editing ----------
const createStep = (op: StepOp): PipelineStep => {
  const def = stepDef(op);
  return {
    id: genId(),
    op,
    scope: def?.defaultScope ?? 'whole',
    params: { ...(STEP_DEFAULT_PARAMS[op] ?? {}) },
  };
};

const addStep = (op: StepOp) => {
  steps.value.push(createStep(op));
  store.showToast(t('tools.text_processor.step_added'), { type: 'success' });
};

const handleAddStep = () => {
  addStep(addOpValue.value as StepOp);
};

const removeStep = (id: string) => {
  steps.value = steps.value.filter((s) => s.id !== id);
};

const moveStep = (index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= steps.value.length) {
    return;
  }
  const arr = [...steps.value];
  const [item] = arr.splice(index, 1);
  arr.splice(target, 0, item);
  steps.value = arr;
};

const clearSteps = () => {
  steps.value = [];
};

const setScope = (step: PipelineStep, scope: StepScope) => {
  step.scope = scope;
};

const setParam = (step: PipelineStep, field: StepParamField, event: Event) => {
  const el = event.target as HTMLInputElement;
  if (field.type === 'number') {
    step.params[field.key] = el.value === '' ? '' : Number(el.value);
  } else if (field.type === 'checkbox') {
    step.params[field.key] = el.checked;
  } else {
    step.params[field.key] = el.value;
  }
};

// ---------- Pipeline persistence ----------
const refreshPipelines = () => {
  savedPipelines.value = loadPipelines();
};

// ---------- 快捷键拉起管线（?pipeline=<target>&t=<nonce>） ----------
const route = useRoute();
// setup 时先捕获启动目标；有启动目标时抑制 auto-detection，交给 applyLaunch 处理。
const pendingLaunchTarget = ref<string | null>(
  route.query.pipeline ? String(route.query.pipeline) : null
);
const pendingLaunchNonce = ref<string>(route.query.t ? String(route.query.t) : '0');
const lastLaunchKey = ref('');

/**
 * 解析启动 target 为管线步骤；`preset:<op>`→单步，否则按名加载已存管线。
 * @returns 未找到目标时返回 null
 */
const resolveLaunchSteps = (target: string): PipelineStep[] | null => {
  if (target.startsWith('preset:')) {
    const op = target.slice('preset:'.length) as StepOp;
    if (!stepDef(op)) return null;
    pipelineName.value = '';
    return [createStep(op)];
  }
  const saved = savedPipelines.value.find((p) => p.name === target);
  if (saved) {
    pipelineName.value = saved.name;
    return [...saved.steps];
  }
  return null;
};

/**
 * 应用一次快捷键拉起：加载目标管线并（在输入就绪时）执行。
 * 幂等：相同 `target:nonce` 只跑一次。
 */
const applyLaunch = () => {
  const target = pendingLaunchTarget.value;
  if (!target) return;
  const key = `${target}:${pendingLaunchNonce.value}`;
  if (key === lastLaunchKey.value) return;
  lastLaunchKey.value = key;
  const stepsToSet = resolveLaunchSteps(target);
  if (!stepsToSet) {
    store.showToast(t('tools.text_processor.pipeline_missing', { name: target }), { type: 'warning' });
    pendingLaunchTarget.value = null;
    return;
  }
  steps.value = stepsToSet;
  pendingLaunchTarget.value = null;
  if (inputText.value) {
    void runCurrentPipeline();
  }
};

// 再次按压（t 变化）或改 target 时重新触发
watch(
  () => [route.query.pipeline, route.query.t] as const,
  ([p, t]) => {
    pendingLaunchTarget.value = p ? String(p) : null;
    pendingLaunchNonce.value = t ? String(t) : '0';
    if (pendingLaunchTarget.value) applyLaunch();
  }
);

const saveCurrentPipeline = () => {
  if (steps.value.length === 0) {
    store.showToast(t('tools.text_processor.steps_empty_warning'), { type: 'warning' });
    return;
  }
  const result = savePipeline(pipelineName.value, steps.value);
  if (!result.ok) {
    const key =
      result.error === 'NAME_REQUIRED'
        ? 'tools.text_processor.pipeline_save_name_required'
        : result.error === 'LIMIT_REACHED'
          ? 'tools.text_processor.pipeline_save_limit_reached'
          : 'tools.text_processor.pipeline_save_failed';
    store.showToast(t(key), { type: 'warning' });
    return;
  }
  refreshPipelines();
  store.showToast(t('tools.text_processor.pipeline_saved'), { type: 'success' });
};

const loadSelectedPipeline = () => {
  if (!selectedLoadName.value) {
    store.showToast(t('tools.text_processor.pipeline_select_hint'), { type: 'warning' });
    return;
  }
  const saved = savedPipelines.value.find((p) => p.name === selectedLoadName.value);
  if (!saved) {
    return;
  }
  steps.value = saved.steps.map((step) => ({ ...step, params: { ...step.params } }));
  pipelineName.value = saved.name;
  store.showToast(t('tools.text_processor.pipeline_loaded', { name: saved.name }), {
    type: 'success',
  });
};

const deleteSelectedPipeline = () => {
  if (!selectedLoadName.value) {
    store.showToast(t('tools.text_processor.pipeline_select_hint'), { type: 'warning' });
    return;
  }
  deletePipeline(selectedLoadName.value);
  refreshPipelines();
  store.showToast(t('tools.text_processor.pipeline_deleted', { name: selectedLoadName.value }), {
    type: 'success',
  });
  selectedLoadName.value = '';
};

// ---------- Preset detection（智能搜索预设：转义 / URL / UTF-8 / Base64） ----------
const detectPresetOp = (text: string): StepOp | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const looksEscapedJsonString = (() => {
    const hasEscapedSequence = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/.test(trimmed);
    if (!hasEscapedSequence) {
      return false;
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed.includes('\\"')) {
      return true;
    }
    return trimmed.startsWith('{\\') || trimmed.startsWith('[\\');
  })();
  if (looksEscapedJsonString) {
    return 'remove_escape';
  }

  if (/%[0-9a-fA-F]{2}/.test(trimmed) || (trimmed.includes('%') && trimmed.includes('+'))) {
    try {
      decodeURIComponent(trimmed.replace(/\+/g, ' '));
      return 'url_decode';
    } catch {
      // decode 失败则忽略
    }
  }

  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /^[0-9a-fA-F]{2}$/.test(p))) {
    return 'utf8_decode';
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 20 && !trimmed.includes(' ')) {
    return 'base64_decode';
  }

  return null;
};

// ---------- Run / copy / clear ----------
const runCurrentPipeline = async (options?: { silent?: boolean }) => {
  if (isRunning.value) {
    return;
  }
  if (!inputText.value) {
    if (!options?.silent) {
      store.showToast(t('tools.text_processor.empty_input_warning'), { type: 'warning' });
    }
    return;
  }
  if (steps.value.length === 0) {
    if (!options?.silent) {
      store.showToast(t('tools.text_processor.steps_empty_warning'), { type: 'warning' });
    }
    return;
  }

  isRunning.value = true;
  try {
    const result = await runPipeline(inputText.value, steps.value, pipelineDeps);
    outputText.value = result.text;
    statsReport.value = result.statsReport;

    if (options?.silent) {
      return;
    }

    if (autoCopy.value && result.text) {
      const success = await copyText(result.text);
      if (success) {
        store.showToast(t('tools.text_processor.processed_and_copied'), { type: 'success' });
      } else {
        store.showToast(t('tools.text_processor.processed_but_copy_failed'), { type: 'warning' });
      }
    } else {
      store.showToast(t('tools.text_processor.processed'), { type: 'success' });
    }
  } catch (error) {
    statsReport.value = null;
    const message = error instanceof Error ? error.message : String(error);
    store.showToast(t('tools.text_processor.process_failed', { reason: message }), {
      type: 'error',
    });
  } finally {
    isRunning.value = false;
  }
};

const handleProcess = () => {
  void runCurrentPipeline();
};

const handleCopyResult = async () => {
  if (!outputText.value) {
    store.showToast(t('tools.text_processor.empty_output_warning'), { type: 'warning' });
    return;
  }
  const success = await copyText(outputText.value);
  if (success) {
    store.showToast(t('tools.text_processor.copy_success'), { type: 'success' });
  } else {
    store.showToast(t('tools.text_processor.copy_failed'), { type: 'error' });
  }
};

const clearAll = () => {
  inputText.value = '';
  outputText.value = '';
  statsReport.value = null;
  store.showToast(t('tools.text_processor.cleared'), { type: 'success' });
};

// ---------- Watch / lifecycle ----------
watch(
  () => props.initialData,
  (newVal) => {
    if (!newVal) {
      return;
    }
    inputText.value = newVal;
    // 有快捷键拉起目标时，交由 applyLaunch 统一加载并执行，不做自动检测/预执行。
    if (pendingLaunchTarget.value) {
      return;
    }
    // keep-alive 下组件实例复用：每次收到新的搜索预填内容都重新检测预设，
    // 保证再次从首页粘贴转义/URL/UTF-8/Base64 时仍能命中并自动执行。
    const preset = detectPresetOp(newVal);
    if (preset) {
      steps.value = [createStep(preset)];
      void runCurrentPipeline({ silent: true });
    }
  },
  { immediate: true }
);

// 步骤或输入变化后清空旧统计报告，避免展示过期数据
watch(
  steps,
  () => {
    statsReport.value = null;
  },
  { deep: true }
);

watch(inputText, () => {
  statsReport.value = null;
});

const handleKeydown = (e: KeyboardEvent) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) {
    return;
  }
  const key = e.key.toLowerCase();
  if (key === 'enter') {
    e.preventDefault();
    handleProcess();
  } else if (key === 'l') {
    e.preventDefault();
    clearAll();
  }
};

const registerKeydown = () => window.addEventListener('keydown', handleKeydown);
const unregisterKeydown = () => window.removeEventListener('keydown', handleKeydown);

onMounted(() => {
  refreshPipelines();
  applyLaunch();
});

// keep-alive：工具切走后也要移除窗口级监听，避免在隐藏实例上误触发执行/清空
onActivated(registerKeydown);
onDeactivated(unregisterKeydown);
onUnmounted(unregisterKeydown);
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4 bg-background text-foreground min-h-0 overflow-hidden">
    <div ref="containerRef" class="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
      <!-- 左：输入 -->
      <div
        ref="firstPanelRef"
        class="relative flex flex-col gap-2 min-h-0"
        :style="firstPanelWidth === null ? undefined : { flex: '0 0 auto', width: `${firstPanelWidth}px` }"
      >
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">{{ t('tools.text_processor.input_title') }}</label>
          <span class="text-xs text-muted-foreground">{{ inputText.length }} chars</span>
        </div>
        <textarea
          v-model="inputText"
          data-testid="text-processor-input"
          class="flex-1 w-full min-h-0 p-3 rounded-md border border-border bg-card font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_processor.input_placeholder')"
        ></textarea>
        <div
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.text_processor.resize_aria')"
          aria-orientation="vertical"
          tabindex="0"
          @pointerdown.prevent="startResize"
          @keydown="handleResizeKeydown"
        ></div>
      </div>

      <!-- 中：控制区（步骤编辑器） -->
      <div
        class="w-full md:w-80 lg:w-96 shrink-0 p-4 bg-card rounded-md border border-border overflow-y-auto flex flex-col gap-4 min-h-0"
      >
        <!-- 步骤列表 -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">{{ t('tools.text_processor.steps_title') }}</span>
            <button
              v-if="steps.length"
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              @click="clearSteps"
            >
              <Trash2 class="w-3 h-3" />
              {{ t('tools.text_processor.clear_steps') }}
            </button>
          </div>

          <div
            v-if="steps.length === 0"
            class="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3 text-center"
          >
            {{ t('tools.text_processor.steps_empty_hint') }}
          </div>

          <div
            v-for="(step, index) in steps"
            :key="step.id"
            class="border border-border rounded-md p-2 flex flex-col gap-2"
          >
            <div class="flex items-center gap-1">
              <span class="text-xs text-muted-foreground w-4 shrink-0">{{ index + 1 }}</span>
              <span class="text-sm font-medium flex-1 min-w-0 truncate" :title="stepLabel(step.op)">
                {{ stepLabel(step.op) }}
              </span>
              <div v-if="stepDef(step.op)?.scopeSupported" class="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  class="text-[11px] px-1.5 py-0.5 rounded border transition-colors"
                  :class="
                    step.scope === 'whole'
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  "
                  @click="setScope(step, 'whole')"
                >
                  {{ t('tools.text_processor.scope_whole') }}
                </button>
                <button
                  type="button"
                  class="text-[11px] px-1.5 py-0.5 rounded border transition-colors"
                  :class="
                    step.scope === 'line'
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  "
                  @click="setScope(step, 'line')"
                >
                  {{ t('tools.text_processor.scope_line') }}
                </button>
              </div>
              <button
                type="button"
                class="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                :disabled="index === 0"
                :aria-label="t('tools.text_processor.move_up')"
                :title="t('tools.text_processor.move_up')"
                @click="moveStep(index, -1)"
              >
                <ArrowUp class="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                class="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                :disabled="index === steps.length - 1"
                :aria-label="t('tools.text_processor.move_down')"
                :title="t('tools.text_processor.move_down')"
                @click="moveStep(index, 1)"
              >
                <ArrowDown class="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                class="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                :aria-label="t('tools.text_processor.delete_step')"
                :title="t('tools.text_processor.delete_step')"
                @click="removeStep(step.id)"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>

            <div v-if="fieldsFor(step.op).length" class="grid gap-1.5 pt-2 border-t border-border">
              <template v-for="field in fieldsFor(step.op)" :key="field.key">
                <label
                  v-if="field.type === 'checkbox'"
                  class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    :checked="step.params[field.key] === true"
                    class="h-3.5 w-3.5 rounded border-border text-primary"
                    @change="setParam(step, field, $event)"
                  />
                  {{ t(`tools.text_processor.${field.label}`) }}
                </label>
                <div v-else class="flex flex-col gap-0.5">
                  <label class="text-xs text-muted-foreground">
                    {{ t(`tools.text_processor.${field.label}`) }}
                  </label>
                  <select
                    v-if="field.type === 'select'"
                    :value="String(step.params[field.key] ?? '')"
                    class="px-2 py-1 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    @change="setParam(step, field, $event)"
                  >
                    <option
                      v-for="opt in field.options"
                      :key="String(opt.value)"
                      :value="String(opt.value)"
                    >
                      {{ t(`tools.text_processor.${opt.label}`) }}
                    </option>
                  </select>
                  <input
                    v-else
                    :type="field.type"
                    :value="String(step.params[field.key] ?? '')"
                    :placeholder="
                      field.placeholder ? t(`tools.text_processor.${field.placeholder}`) : undefined
                    "
                    class="px-2 py-1 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    @input="setParam(step, field, $event)"
                  />
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- 添加步骤 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-muted-foreground">{{ t('tools.text_processor.add_step') }}</label>
          <div class="flex items-center gap-1.5">
            <select
              v-model="addCategoryValue"
              data-testid="text-processor-add-category"
              class="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option v-for="cat in STEP_CATEGORIES" :key="cat.value" :value="cat.value">
                {{ t(`tools.text_processor.cat_${cat.label}`) }}
              </option>
            </select>
            <select
              v-model="addOpValue"
              data-testid="text-processor-add-op"
              class="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option v-for="item in currentCategoryItems" :key="item.op" :value="item.op">
                {{ t(`tools.text_processor.type_${item.label}`) }}
              </option>
            </select>
            <button
              type="button"
              data-testid="text-processor-add-step-button"
              class="p-2 shrink-0 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              :aria-label="t('tools.text_processor.add_step')"
              @click="handleAddStep"
            >
              <Plus class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- 管线执行 -->
        <div class="flex flex-col gap-2">
          <button
            type="button"
            data-testid="text-processor-process-button"
            class="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium shadow-sm disabled:opacity-50"
            :disabled="isRunning"
            @click="handleProcess"
          >
            <Play class="w-4 h-4" />
            {{ isRunning ? t('tools.text_processor.running') : t('tools.text_processor.run_pipeline') }}
          </button>
          <div class="flex items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input v-model="autoCopy" type="checkbox" class="h-4 w-4 rounded border-border text-primary focus:ring-primary">
              <span>{{ t('tools.text_processor.auto_copy') }}</span>
            </label>
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors text-sm"
              @click="handleCopyResult"
            >
              <Copy class="w-4 h-4" />
              {{ t('tools.text_processor.copy_btn') }}
            </button>
          </div>
        </div>

        <div class="my-1 border-t border-border"></div>

        <!-- 保存管线 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-muted-foreground" for="text-processor-pipeline-name">
            {{ t('tools.text_processor.pipeline_name') }}
          </label>
          <div class="flex items-center gap-1.5">
            <input
              id="text-processor-pipeline-name"
              v-model="pipelineName"
              class="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              :placeholder="t('tools.text_processor.pipeline_name_placeholder')"
            />
            <button
              type="button"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-sm"
              @click="saveCurrentPipeline"
            >
              <Save class="w-4 h-4" />
              {{ t('tools.text_processor.save_pipeline') }}
            </button>
          </div>
        </div>

        <!-- 加载 / 删除管线 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-muted-foreground">{{ t('tools.text_processor.load_pipeline') }}</label>
          <div class="flex items-center gap-1.5">
            <select
              v-model="selectedLoadName"
              class="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">{{ t('tools.text_processor.pipeline_select_placeholder') }}</option>
              <option v-for="p in savedPipelines" :key="p.name" :value="p.name">
                {{ p.name }}
              </option>
            </select>
            <button
              type="button"
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-sm"
              @click="loadSelectedPipeline"
            >
              <FolderOpen class="w-4 h-4" />
              {{ t('tools.text_processor.load_btn') }}
            </button>
          </div>
          <button
            v-if="selectedLoadName"
            type="button"
            class="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors text-sm"
            @click="deleteSelectedPipeline"
          >
            <Trash2 class="w-4 h-4" />
            {{ t('tools.text_processor.delete_pipeline') }}
          </button>
        </div>

        <div class="my-1 border-t border-border"></div>

        <button
          type="button"
          class="flex items-center justify-center gap-2 px-4 py-2 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 transition-colors text-sm"
          @click="clearAll"
        >
          <Trash2 class="w-4 h-4" />
          {{ t('tools.text_processor.clear_btn') }}
        </button>
      </div>

      <!-- 右：输出 + 统计报告 -->
      <div class="flex-1 flex flex-col gap-2 min-h-0">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">{{ t('tools.text_processor.output_title') }}</label>
          <span class="text-xs text-muted-foreground">{{ outputText.length }} chars</span>
        </div>
        <textarea
          v-model="outputText"
          data-testid="text-processor-output"
          readonly
          class="flex-1 w-full min-h-0 p-3 rounded-md border border-border bg-muted/30 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_processor.output_placeholder')"
        ></textarea>

        <div
          v-if="hasStatsStep && !statsReport"
          class="text-xs text-muted-foreground border border-dashed border-border rounded-md p-2 shrink-0"
        >
          {{ t('tools.text_processor.stats_hint') }}
        </div>

        <div
          v-if="statsReport"
          class="border border-border rounded-md p-3 bg-card flex flex-col gap-2 shrink-0"
        >
          <div class="text-sm font-medium">{{ t('tools.text_processor.stats_title') }}</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_chars') }}</span>
              <span class="font-mono font-medium">{{ statsReport.chars }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_chars_no_space') }}</span>
              <span class="font-mono font-medium">{{ statsReport.charsNoSpace }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_words') }}</span>
              <span class="font-mono font-medium">{{ statsReport.words }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_lines') }}</span>
              <span class="font-mono font-medium">{{ statsReport.lines }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_paragraphs') }}</span>
              <span class="font-mono font-medium">{{ statsReport.paragraphs }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 rounded bg-muted/40 px-2 py-1">
              <span class="text-muted-foreground">{{ t('tools.text_processor.stats_chinese') }}</span>
              <span class="font-mono font-medium">{{ statsReport.chineseChars }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 text-xs min-w-0">
            <span class="text-muted-foreground shrink-0">{{ t('tools.text_processor.stats_longest_line') }}:</span>
            <span class="font-mono truncate" :title="statsReport.longestLine.text">
              {{ statsReport.longestLine.text || '—' }}
            </span>
            <span class="text-muted-foreground shrink-0">({{ statsReport.longestLine.length }})</span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-xs text-muted-foreground">
              {{ t('tools.text_processor.stats_top_chars', { count: statsReport.topChars.length }) }}
            </div>
            <div v-if="statsReport.topChars.length" class="flex flex-wrap gap-1">
              <span
                v-for="item in statsReport.topChars"
                :key="`${item.char}-${item.count}`"
                class="tech-tag"
              >
                {{ displayChar(item.char) }}: {{ item.count }}
              </span>
            </div>
            <div v-else class="text-xs text-muted-foreground">
              {{ t('tools.text_processor.stats_top_empty') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
