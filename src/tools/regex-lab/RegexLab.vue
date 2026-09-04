<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { AlertCircle, CheckCircle2, Copy, Eraser, Regex as RegexIcon } from 'lucide-vue-next';
import { useAppStore } from '@/store/app';
import {
  REGEX_FLAGS,
  compileRegex,
  findMatches,
  parseRegexLiteral,
  replacePreview,
  type RegexFlag,
  type RegexMatchItem,
} from './engine';

interface Props {
  initialData?: string | { pattern?: string; flags?: string; text?: string };
}

const DEFAULT_PATTERN = '(\\w+)@(\\w+)\\.(\\w+)';

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const buildDefaultTestText = () =>
  [
    t('tools.regex_lab.example_email'),
    t('tools.regex_lab.example_backup_email'),
    t('tools.regex_lab.example_plain'),
  ].join('\n');

const pattern = ref(DEFAULT_PATTERN);
const selectedFlags = ref<RegexFlag[]>(['g']);
const testText = ref(buildDefaultTestText());
const replaceTemplate = ref('$1');

/**
 * 仅当输入是 /pattern/flags 或短 pattern 时写入 pattern；
 * 普通长文本写入测试区，避免首页剪贴板内容卡死页面。
 */
const applyInitialData = (value: Props['initialData']) => {
  if (value == null) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;

    const literal = parseRegexLiteral(trimmed);
    if (literal) {
      pattern.value = literal.pattern;
      const nextFlags = literal.flags
        .split('')
        .filter((flag): flag is RegexFlag => REGEX_FLAGS.includes(flag as RegexFlag));
      selectedFlags.value = nextFlags.length ? nextFlags : ['g'];
      return;
    }

    const looksLikePattern =
      trimmed.length <= 200 && !trimmed.includes('\n') && /[\\^$.*+?()[\]{}|]/.test(trimmed);

    if (looksLikePattern) {
      pattern.value = trimmed;
      return;
    }

    testText.value = value;
    return;
  }

  if (typeof value.pattern === 'string' && value.pattern.length <= 2000) {
    pattern.value = value.pattern;
  }
  if (typeof value.text === 'string') {
    testText.value = value.text;
  }
  if (value.flags) {
    const nextFlags = value.flags
      .split('')
      .filter((flag): flag is RegexFlag => REGEX_FLAGS.includes(flag as RegexFlag));
    selectedFlags.value = nextFlags.length ? nextFlags : ['g'];
  }
};

applyInitialData(props.initialData);

const flagOptions = REGEX_FLAGS.map((flag) => ({
  value: flag,
  labelKey: `tools.regex_lab.flag_${flag}` as const,
}));

const flagsString = computed(() => selectedFlags.value.join(''));
const compiled = computed(() => compileRegex(pattern.value, flagsString.value));
const matchResult = computed(() => findMatches(pattern.value, flagsString.value, testText.value));
const replaceResult = computed(() =>
  replacePreview(pattern.value, flagsString.value, testText.value, replaceTemplate.value),
);
const matches = computed<RegexMatchItem[]>(() => (matchResult.value.ok ? matchResult.value.matches : []));

const toggleFlag = (flag: RegexFlag) => {
  if (selectedFlags.value.includes(flag)) {
    selectedFlags.value = selectedFlags.value.filter((item) => item !== flag);
    return;
  }
  selectedFlags.value = [...selectedFlags.value, flag];
};

const copyToClipboard = async (text: string) => {
  if (!(await copyText(text))) throw new Error('clipboard-unavailable');
};

const formatMatchesForCopy = (items: RegexMatchItem[]) =>
  items
    .map((item, order) => {
      const groupText = item.groups.length
        ? ` groups=[${item.groups.map((group) => JSON.stringify(group)).join(', ')}]`
        : '';
      const namedKeys = Object.keys(item.namedGroups);
      const namedText = namedKeys.length ? ` named=${JSON.stringify(item.namedGroups)}` : '';
      return `#${order + 1} index=${item.index} match=${JSON.stringify(item.match)}${groupText}${namedText}`;
    })
    .join('\n');

const copyMatches = async () => {
  if (!matches.value.length) {
    store.showToast(t('tools.regex_lab.empty_copy_warning'), { type: 'warning' });
    return;
  }
  try {
    await copyToClipboard(formatMatchesForCopy(matches.value));
    store.showToast(t('tools.regex_lab.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.regex_lab.copy_failed'), { type: 'error' });
  }
};

const copyReplaceResult = async () => {
  if (!replaceResult.value.ok || !replaceResult.value.result) {
    store.showToast(t('tools.regex_lab.empty_copy_warning'), { type: 'warning' });
    return;
  }
  try {
    await copyToClipboard(replaceResult.value.result);
    store.showToast(t('tools.regex_lab.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.regex_lab.copy_failed'), { type: 'error' });
  }
};

const clearAll = () => {
  pattern.value = DEFAULT_PATTERN;
  selectedFlags.value = ['g'];
  testText.value = buildDefaultTestText();
  replaceTemplate.value = '$1';
};

watch(
  () => props.initialData,
  (value) => {
    applyInitialData(value);
  },
);
</script>

<template>
  <!-- 使用 skin 变量 + 明确 min-height，避免 h-full 高度链断裂导致内容被 overflow-hidden 裁成空白 -->
  <div data-testid="regex-lab-root" class="regex-lab">
    <header class="regex-lab__header">
      <div class="regex-lab__icon">
        <RegexIcon class="h-5 w-5" />
      </div>
      <div>
        <h2 class="regex-lab__title">{{ t('tools.regex_lab.title') }}</h2>
        <p class="regex-lab__subtitle">{{ t('tools.regex_lab.subtitle') }}</p>
      </div>
    </header>

    <div class="regex-lab__grid">
      <section class="regex-lab__panel">
        <div class="regex-lab__field">
          <label for="regex-pattern">{{ t('tools.regex_lab.pattern_label') }}</label>
          <input
            id="regex-pattern"
            v-model="pattern"
            data-testid="regex-pattern-input"
            type="text"
            spellcheck="false"
            class="regex-lab__input"
            :placeholder="t('tools.regex_lab.pattern_placeholder')"
          />
        </div>

        <div class="regex-lab__field">
          <div class="regex-lab__label">{{ t('tools.regex_lab.flags_label') }}</div>
          <div class="regex-lab__flags">
            <button
              v-for="option in flagOptions"
              :key="option.value"
              type="button"
              :data-testid="`regex-flag-${option.value}`"
              class="regex-lab__flag"
              :class="{ 'is-active': selectedFlags.includes(option.value) }"
              @click="toggleFlag(option.value)"
            >
              {{ t(option.labelKey) }}
            </button>
          </div>
        </div>

        <div class="regex-lab__field regex-lab__field--grow">
          <label for="regex-test-text">{{ t('tools.regex_lab.test_text_label') }}</label>
          <textarea
            id="regex-test-text"
            v-model="testText"
            data-testid="regex-test-text"
            spellcheck="false"
            class="regex-lab__textarea"
            :placeholder="t('tools.regex_lab.test_text_placeholder')"
          />
        </div>

        <div class="regex-lab__field">
          <label for="regex-replace-template">{{ t('tools.regex_lab.replace_label') }}</label>
          <input
            id="regex-replace-template"
            v-model="replaceTemplate"
            data-testid="regex-replace-template"
            type="text"
            spellcheck="false"
            class="regex-lab__input"
            :placeholder="t('tools.regex_lab.replace_placeholder')"
          />
        </div>

        <div class="regex-lab__actions">
          <button type="button" data-testid="regex-copy-matches" class="regex-lab__btn" @click="copyMatches">
            <Copy class="h-4 w-4" />
            {{ t('tools.regex_lab.copy_matches') }}
          </button>
          <button type="button" data-testid="regex-copy-replace" class="regex-lab__btn" @click="copyReplaceResult">
            <Copy class="h-4 w-4" />
            {{ t('tools.regex_lab.copy_replace') }}
          </button>
          <button type="button" data-testid="regex-clear" class="regex-lab__btn" @click="clearAll">
            <Eraser class="h-4 w-4" />
            {{ t('tools.regex_lab.clear') }}
          </button>
        </div>
      </section>

      <section class="regex-lab__panel">
        <div class="regex-lab__status" :class="compiled.ok ? 'is-ok' : 'is-bad'">
          <div class="regex-lab__status-row">
            <span>{{ t('tools.regex_lab.status_title') }}</span>
            <span data-testid="regex-status" class="regex-lab__status-badge">
              <CheckCircle2 v-if="compiled.ok" class="h-4 w-4" />
              <AlertCircle v-else class="h-4 w-4" />
              {{ compiled.ok ? t('tools.regex_lab.status_valid') : t('tools.regex_lab.status_invalid') }}
            </span>
          </div>
          <div class="regex-lab__literal">/{{ pattern || '...' }}/{{ flagsString }}</div>
          <div v-if="!compiled.ok" data-testid="regex-error" class="regex-lab__error">
            {{ compiled.error }}
          </div>
        </div>

        <div class="regex-lab__matches">
          <div class="regex-lab__status-row">
            <span>{{ t('tools.regex_lab.matches_title') }}</span>
            <span class="regex-lab__muted">{{ t('tools.regex_lab.matches_count', { count: matches.length }) }}</span>
          </div>

          <div
            v-if="!matches.length"
            data-testid="regex-matches-empty"
            class="regex-lab__empty"
          >
            {{ t('tools.regex_lab.matches_empty') }}
          </div>

          <div v-else data-testid="regex-matches-list" class="regex-lab__match-list">
            <article
              v-for="(item, order) in matches"
              :key="`${item.index}-${order}-${item.match}`"
              class="regex-lab__match"
            >
              <div class="regex-lab__muted">
                #{{ order + 1 }} · {{ t('tools.regex_lab.match_index') }}: {{ item.index }}
              </div>
              <div class="regex-lab__match-text">
                <span class="regex-lab__muted">{{ t('tools.regex_lab.match_text') }}:</span>
                {{ item.match }}
              </div>
              <div v-if="item.groups.length" class="regex-lab__muted">
                {{ t('tools.regex_lab.match_groups') }}:
                [{{ item.groups.map((group) => JSON.stringify(group)).join(', ') }}]
              </div>
              <div v-if="Object.keys(item.namedGroups).length" class="regex-lab__muted">
                {{ t('tools.regex_lab.match_named_groups') }}:
                {{ JSON.stringify(item.namedGroups) }}
              </div>
            </article>
          </div>
        </div>

        <div class="regex-lab__field regex-lab__field--grow">
          <div class="regex-lab__label">{{ t('tools.regex_lab.replace_preview_title') }}</div>
          <textarea
            data-testid="regex-replace-preview"
            readonly
            class="regex-lab__textarea"
            :value="replaceResult.ok ? replaceResult.result : ''"
            :placeholder="t('tools.regex_lab.replace_preview_placeholder')"
          />
          <div v-if="!replaceResult.ok" data-testid="regex-replace-error" class="regex-lab__error">
            {{ replaceResult.error }}
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.regex-lab {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  height: 100%;
  overflow: auto;
  padding: 16px;
  color: var(--skin-text-main, #1e293b);
  background: var(--skin-panel-bg, rgba(255, 255, 255, 0.94));
}

.regex-lab__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

.regex-lab__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.1));
  color: var(--skin-accent, #06b6d4);
  background: rgba(var(--skin-accent-rgb, 6 182 212) / 0.1);
}

.regex-lab__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--skin-text-strong, #0b1426);
}

.regex-lab__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--skin-text-muted, #64748b);
}

.regex-lab__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  flex: 1;
  min-height: 480px;
}

@media (min-width: 1100px) {
  .regex-lab__grid {
    grid-template-columns: minmax(320px, 420px) minmax(360px, 1fr);
  }
}

.regex-lab__panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.1));
  background: var(--skin-surface, #fff);
}

.regex-lab__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.regex-lab__field--grow {
  flex: 1;
  min-height: 140px;
}

.regex-lab__field label,
.regex-lab__label {
  font-size: 13px;
  color: var(--skin-text-muted, #64748b);
}

.regex-lab__input,
.regex-lab__textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.12));
  background: var(--skin-surface-elevated, #f8fbff);
  color: var(--skin-text-main, #1e293b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  padding: 10px 12px;
  outline: none;
}

.regex-lab__input:focus,
.regex-lab__textarea:focus {
  border-color: var(--skin-accent, #06b6d4);
  box-shadow: 0 0 0 2px rgba(var(--skin-accent-rgb, 6 182 212) / 0.2);
}

.regex-lab__textarea {
  min-height: 140px;
  flex: 1;
  resize: vertical;
}

.regex-lab__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.regex-lab__flag {
  border-radius: 8px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.12));
  background: transparent;
  color: var(--skin-text-main, #1e293b);
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}

.regex-lab__flag.is-active {
  border-color: var(--skin-accent, #06b6d4);
  color: var(--skin-accent, #06b6d4);
  background: rgba(var(--skin-accent-rgb, 6 182 212) / 0.12);
}

.regex-lab__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.regex-lab__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.12));
  background: transparent;
  color: var(--skin-text-main, #1e293b);
  font-size: 12px;
  padding: 8px 10px;
  cursor: pointer;
}

.regex-lab__btn:hover {
  background: rgba(var(--skin-accent-rgb, 6 182 212) / 0.08);
}

.regex-lab__status {
  border-radius: 10px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.1));
  padding: 12px;
}

.regex-lab__status.is-ok {
  background: rgba(16, 185, 129, 0.08);
}

.regex-lab__status.is-bad {
  background: rgba(244, 63, 94, 0.08);
}

.regex-lab__status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  font-weight: 600;
}

.regex-lab__status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.regex-lab__status.is-ok .regex-lab__status-badge {
  color: #059669;
}

.regex-lab__status.is-bad .regex-lab__status-badge {
  color: #e11d48;
}

.regex-lab__literal {
  margin-top: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--skin-text-muted, #64748b);
  word-break: break-all;
}

.regex-lab__error {
  margin-top: 8px;
  font-size: 13px;
  color: #e11d48;
  word-break: break-word;
}

.regex-lab__matches {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.regex-lab__muted {
  font-size: 12px;
  color: var(--skin-text-muted, #64748b);
}

.regex-lab__empty {
  border: 1px dashed var(--skin-border, rgba(15, 23, 42, 0.15));
  border-radius: 10px;
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--skin-text-muted, #64748b);
}

.regex-lab__match-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.regex-lab__match {
  border-radius: 10px;
  border: 1px solid var(--skin-border, rgba(15, 23, 42, 0.1));
  background: var(--skin-surface-elevated, #f8fbff);
  padding: 10px 12px;
}

.regex-lab__match-text {
  margin-top: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  word-break: break-all;
}
</style>
