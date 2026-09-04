<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { Settings2, X } from 'lucide-vue-next';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogDescription,
} from 'radix-vue';
import type { CompareResult, JsonDiffConfig } from './index';
import { compareJson } from './index';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();

const jsonA = ref('');
const jsonB = ref('');
const error = ref('');
const result = ref<CompareResult | null>(null);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 300, minSecondWidth: 300 });

const config = ref<JsonDiffConfig>({
  arrayStrategy: 'INDEX',
  arrayKeyFields: [],
  missingEqualsNull: false,
  numericStringAsNumber: false,
  floatAbsoluteEpsilon: 0,
  floatRelativeEpsilon: 0,
  stringTrim: false,
  stringCaseInsensitive: false,
  ignorePaths: [],
  onlyComparePaths: [],
  redactPaths: [],
  includeIgnored: false,
  maxDiffs: 2000,
  maxValueLength: 1000,
  diffSort: 'path',
  maxDepth: 200,
});

const ignorePathsText = ref('');
const onlyComparePathsText = ref('');
const redactPathsText = ref('');

/**
 * 将输入的多行路径文本解析为列表
 * @param text 原始文本
 */
const parsePathList = (text: string): string[] => {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

/**
 * 执行 JSON 对比
 */
const runCompare = () => {
  error.value = '';
  result.value = null;
  try {
    const a = jsonA.value.trim() ? JSON.parse(jsonA.value) : {};
    const b = jsonB.value.trim() ? JSON.parse(jsonB.value) : {};
    config.value.ignorePaths = parsePathList(ignorePathsText.value);
    config.value.onlyComparePaths = parsePathList(onlyComparePathsText.value);
    config.value.redactPaths = parsePathList(redactPathsText.value);
    result.value = compareJson(a, b, config.value);
  } catch (e) {
    error.value = (e as { message?: string } | null)?.message || t('tools.json_diff.parse_error');
  }
};

/**
 * 复制对比结果为 JSON
 */
const copyResultJson = async () => {
  if (!result.value) return;
  const payload = JSON.stringify(result.value, null, 2);
  await copyText(payload);
};

/**
 * 设置数组主键字段
 * @param text 文本，逗号分隔
 */
const setArrayKeyFields = (text: string) => {
  config.value.arrayKeyFields = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

/**
 * 初始化初始数据：若只提供一份 JSON，则填入 A
 */
watch(
  () => props.initialData,
  (v) => {
    if (!v) return;
    const trimmed = v.trim();
    const parts = trimmed.split(/\n-{3,}\n/);
    if (parts.length === 2) {
      jsonA.value = parts[0].trim();
      jsonB.value = parts[1].trim();
      return;
    }
    jsonA.value = trimmed;
  },
  { immediate: true }
);

const overallColor = computed(() => {
  if (!result.value) return 'text-muted-foreground';
  return result.value.overall === 'identical'
    ? 'text-emerald-600'
    : result.value.overall === 'partial'
    ? 'text-amber-600'
    : 'text-red-600';
});
</script>

<template>
  <div class="json-diff h-full flex flex-col p-4 gap-4 bg-background">
    <!-- Input Area: Auto-resize based on result presence -->
    <div ref="containerRef" class="grid grid-cols-2 gap-4 min-h-0" :class="result ? 'h-64 shrink-0' : 'flex-1'" :style="{ gridTemplateColumns: firstPanelWidth === null ? undefined : `${firstPanelWidth}px minmax(300px, 1fr)` }">
      <div ref="firstPanelRef" class="relative flex flex-col gap-2 min-h-0">
        <div class="text-sm font-medium text-muted-foreground">JSON A (expected/old)</div>
        <textarea
          v-model="jsonA"
          data-testid="json-diff-input-a"
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          :placeholder="t('tools.json_diff.placeholder')"
        />
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.json_diff.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </div>
      <div class="flex flex-col gap-2 min-h-0">
        <div class="text-sm font-medium text-muted-foreground">JSON B (actual/new)</div>
        <textarea
          v-model="jsonB"
          data-testid="json-diff-input-b"
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          :placeholder="t('tools.json_diff.placeholder')"
        />
      </div>
    </div>

    <!-- Action Bar -->
    <div class="flex items-center gap-3 flex-wrap">
      <!-- Settings Dialog -->
      <DialogRoot>
        <DialogTrigger as-child>
          <button
            class="p-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            :title="t('tools.json_diff.config_title')"
          >
            <Settings2 class="w-5 h-5" />
          </button>
        </DialogTrigger>
        <DialogPortal>
          <DialogOverlay class="fixed inset-0 bg-black/50 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogContent class="fixed left-[50%] top-[50%] z-50 grid w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div class="flex flex-col gap-1.5 text-center sm:text-left">
              <DialogTitle class="text-lg font-semibold leading-none tracking-tight">{{ t('tools.json_diff.config_title') }}</DialogTitle>
              <DialogDescription class="text-sm text-muted-foreground">
                {{ t('tools.json_diff.config_description') }}
              </DialogDescription>
            </div>
            
            <div class="grid gap-6 py-4">
              <!-- Config Groups -->
              <div class="grid grid-cols-2 gap-6">
                <!-- Group 1: Basic Rules -->
                <div class="flex flex-col gap-3">
                  <h4 class="text-sm font-medium leading-none">{{ t('tools.json_diff.config_group_basic') }}</h4>
                  <div class="flex flex-col gap-2">
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input v-model="config.missingEqualsNull" type="checkbox" class="h-4 w-4 accent-primary rounded border-gray-300" />
                      {{ t('tools.json_diff.option_missing_equals_null') }}
                    </label>
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input v-model="config.numericStringAsNumber" type="checkbox" class="h-4 w-4 accent-primary rounded border-gray-300" />
                      {{ t('tools.json_diff.option_numeric_string_as_number') }}
                    </label>
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input v-model="config.stringTrim" type="checkbox" class="h-4 w-4 accent-primary rounded border-gray-300" />
                      {{ t('tools.json_diff.option_string_trim') }}
                    </label>
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input v-model="config.stringCaseInsensitive" type="checkbox" class="h-4 w-4 accent-primary rounded border-gray-300" />
                      {{ t('tools.json_diff.option_string_case_insensitive') }}
                    </label>
                  </div>
                </div>

                <!-- Group 2: Array Strategy -->
                <div class="flex flex-col gap-3">
                  <h4 class="text-sm font-medium leading-none">{{ t('tools.json_diff.array_strategy') }}</h4>
                  <select v-model="config.arrayStrategy" class="rounded-md border border-border bg-background p-2 text-sm w-full">
                    <option value="INDEX">{{ t('tools.json_diff.array_strategy_index') }}</option>
                    <option value="SET">{{ t('tools.json_diff.array_strategy_set') }}</option>
                    <option value="KEYED">{{ t('tools.json_diff.array_strategy_keyed') }}</option>
                  </select>

                  <div v-if="config.arrayStrategy === 'KEYED'" class="flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.array_key_fields') }}</label>
                    <input
                      type="text"
                      class="rounded-md border border-border bg-background p-2 text-sm w-full"
                      placeholder="id,code"
                      :value="config.arrayKeyFields?.join(',') ?? ''"
                      @input="setArrayKeyFields(($event.target as HTMLInputElement).value)"
                    />
                  </div>
                </div>
              </div>

              <!-- Group 3: Tolerance -->
              <div class="flex flex-col gap-3">
                <h4 class="text-sm font-medium leading-none">{{ t('tools.json_diff.float_tolerance') }}</h4>
                <div class="flex items-center gap-4">
                  <div class="flex-1 flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.absolute_tolerance') }}</label>
                    <input
                      v-model.number="config.floatAbsoluteEpsilon"
                      type="number"
                      step="any"
                      class="rounded-md border border-border bg-background p-2 text-sm w-full"
                      placeholder="0"
                    />
                  </div>
                  <div class="flex-1 flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.relative_tolerance') }}</label>
                    <input
                      v-model.number="config.floatRelativeEpsilon"
                      type="number"
                      step="any"
                      class="rounded-md border border-border bg-background p-2 text-sm w-full"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              <!-- Group 4: Path Filters -->
              <div class="grid grid-cols-3 gap-4">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">{{ t('tools.json_diff.ignore_paths') }}</label>
                  <textarea 
                    v-model="ignorePathsText" 
                    class="rounded-md border border-border bg-background p-2 text-xs h-24 font-mono resize-none" 
                    placeholder="/meta/*"
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">{{ t('tools.json_diff.only_compare_paths') }}</label>
                  <textarea 
                    v-model="onlyComparePathsText" 
                    class="rounded-md border border-border bg-background p-2 text-xs h-24 font-mono resize-none" 
                    placeholder="/data"
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">{{ t('tools.json_diff.redact_paths') }}</label>
                  <textarea 
                    v-model="redactPathsText" 
                    class="rounded-md border border-border bg-background p-2 text-xs h-24 font-mono resize-none" 
                    placeholder="/user/phone"
                  />
                </div>
              </div>

              <!-- Group 5: Output Control -->
              <div class="flex flex-col gap-3">
                <h4 class="text-sm font-medium leading-none">{{ t('tools.json_diff.output_control') }}</h4>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div class="flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.max_diffs') }}</label>
                    <input v-model.number="config.maxDiffs" type="number" class="rounded-md border border-border bg-background p-2 text-sm w-full" />
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.max_value_length') }}</label>
                    <input v-model.number="config.maxValueLength" type="number" class="rounded-md border border-border bg-background p-2 text-sm w-full" />
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label class="text-xs text-muted-foreground">{{ t('tools.json_diff.sort_mode') }}</label>
                    <select v-model="config.diffSort" class="rounded-md border border-border bg-background p-2 text-sm w-full">
                      <option value="path">{{ t('tools.json_diff.sort_by_path') }}</option>
                      <option value="severity">{{ t('tools.json_diff.sort_by_severity') }}</option>
                    </select>
                  </div>
                  <div class="flex items-center pt-5">
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input v-model="config.includeIgnored" type="checkbox" class="h-4 w-4 accent-primary rounded border-gray-300" />
                      {{ t('tools.json_diff.output_ignored') }}
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <DialogClose class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X class="h-4 w-4" />
              <span class="sr-only">Close</span>
            </DialogClose>
            
            <div class="flex justify-end">
              <DialogClose as-child>
                <button class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors">
                  {{ t('tools.json_diff.confirm_and_close') }}
                </button>
              </DialogClose>
            </div>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>

      <!-- Spacer -->
      <div class="flex-1"></div>

      <button data-testid="json-diff-compare-button" class="px-6 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium text-sm shadow-sm" @click="runCompare">
        {{ t('tools.json_diff.compare_btn') }}
      </button>
      <button class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors text-sm font-medium" @click="copyResultJson">
        {{ t('tools.json_diff.copy_result_json') }}
      </button>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm font-mono animate-in fade-in slide-in-from-top-2">
      {{ error }}
    </div>

    <!-- Results Area -->
    <div v-if="result" data-testid="json-diff-result" class="rounded-md border border-border p-3 bg-card flex flex-col gap-3 flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-4">
      <div class="text-sm flex items-center justify-between">
        <div>
          {{ t('tools.json_diff.overall_title') }}
          <span :class="overallColor" class="font-semibold">{{ t('tools.json_diff.overall_' + result!.overall) }}</span>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('tools.json_diff.duration', { duration: result!.meta?.duration ?? 0 }) }}
        </div>
      </div>
      
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md border border-border/50">
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_added') }}</span> {{ result!.summary.added }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_removed') }}</span> {{ result!.summary.removed }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_changed') }}</span> {{ result!.summary.changed }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_type_mismatch') }}</span> {{ result!.summary.typeMismatch }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_array_issues') }}</span> {{ result!.summary.arrayIssues }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_ignored') }}</span> {{ result!.summary.ignored }}</div>
        <div class="flex gap-1"><span class="font-medium text-foreground">{{ t('tools.json_diff.summary_errors') }}</span> {{ result!.summary.errors }}</div>
      </div>
      
      <div v-if="result!.summary.truncated" class="text-amber-600 text-xs px-2">{{ t('tools.json_diff.truncated_warning') }}</div>

      <div class="flex-1 min-h-0 overflow-auto custom-scrollbar border rounded-md">
        <table class="w-full text-sm relative border-collapse">
          <thead class="sticky top-0 bg-muted/80 backdrop-blur z-10 shadow-sm">
            <tr>
              <th class="text-left p-2 border-b border-border w-64 font-medium text-muted-foreground text-xs">{{ t('tools.json_diff.col_path') }}</th>
              <th class="text-left p-2 border-b border-border w-32 font-medium text-muted-foreground text-xs">{{ t('tools.json_diff.col_type') }}</th>
              <th class="text-left p-2 border-b border-border font-medium text-muted-foreground text-xs">old</th>
              <th class="text-left p-2 border-b border-border font-medium text-muted-foreground text-xs">new</th>
              <th class="text-left p-2 border-b border-border w-64 font-medium text-muted-foreground text-xs">{{ t('tools.json_diff.col_note') }}</th>
            </tr>
          </thead>
          <tbody class="bg-card">
            <tr v-for="(d, idx) in result!.diffs" :key="idx" class="align-top hover:bg-muted/50 transition-colors group">
              <td class="p-2 border-b border-border font-mono text-xs text-muted-foreground break-all group-hover:text-foreground">{{ d.path || '/' }}</td>
              <td class="p-2 border-b border-border text-xs">
                <span 
                  class="px-1.5 py-0.5 rounded-full text-[10px] font-medium border"
                  :class="{
                    'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30': d.diffType.includes('EXTRA') || d.diffType === 'EXTRA_IN_B',
                    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30': d.diffType.includes('MISSING') || d.diffType === 'MISSING_IN_B',
                    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30': d.diffType.includes('MISMATCH'),
                    'bg-muted text-muted-foreground border-border': d.diffType === 'IGNORED'
                  }"
                >
                  {{ d.diffType }}
                </span>
              </td>
              <td class="p-2 border-b border-border font-mono text-xs whitespace-pre-wrap break-all text-red-600/80 dark:text-red-400/80">{{ d.oldValue === undefined ? '' : d.oldValue }}</td>
              <td class="p-2 border-b border-border font-mono text-xs whitespace-pre-wrap break-all text-green-600/80 dark:text-green-400/80">{{ d.newValue === undefined ? '' : d.newValue }}</td>
              <td class="p-2 border-b border-border text-xs text-muted-foreground">{{ d.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
