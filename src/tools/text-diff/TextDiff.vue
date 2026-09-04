<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buildTextDiff } from './diff';

const { t } = useI18n();

const leftText = ref('');
const rightText = ref('');
const ignoreWhitespace = ref(false);
const ignoreCase = ref(false);
type ScrollSide = 'left' | 'right';
const activeSide = ref<null | ScrollSide>(null);
const leftScrollRef = ref<HTMLTextAreaElement | null>(null);
const rightScrollRef = ref<HTMLTextAreaElement | null>(null);
const stageScrollRef = ref<HTMLDivElement | null>(null);
const mirroredScrollTop = ref<Record<ScrollSide, number | null>>({
  left: null,
  right: null,
});

const diffLines = computed(() =>
  buildTextDiff(leftText.value, rightText.value, {
    ignoreWhitespace: ignoreWhitespace.value,
    ignoreCase: ignoreCase.value,
  })
);

const hasInput = computed(() => leftText.value.length > 0 || rightText.value.length > 0);

const swapTexts = () => {
  const currentLeft = leftText.value;
  leftText.value = rightText.value;
  rightText.value = currentLeft;
};

const clearTexts = () => {
  leftText.value = '';
  rightText.value = '';
  activeSide.value = null;
  mirroredScrollTop.value.left = null;
  mirroredScrollTop.value.right = null;
  if (leftScrollRef.value) {
    leftScrollRef.value.scrollTop = 0;
  }
  if (rightScrollRef.value) {
    rightScrollRef.value.scrollTop = 0;
  }
  if (stageScrollRef.value) {
    stageScrollRef.value.scrollTop = 0;
  }
};

const syncScroll = (source: ScrollSide) => {
  const current = source === 'left' ? leftScrollRef.value : rightScrollRef.value;
  const targetSide: ScrollSide = source === 'left' ? 'right' : 'left';
  const target = targetSide === 'left' ? leftScrollRef.value : rightScrollRef.value;
  if (!current || !target) return;
  const nextScrollTop = current.scrollTop;

  if (mirroredScrollTop.value[source] === nextScrollTop) {
    mirroredScrollTop.value[source] = null;
    return;
  }

  if (target.scrollTop !== nextScrollTop) {
    target.scrollTop = nextScrollTop;
    mirroredScrollTop.value[targetSide] = target.scrollTop;
  }

  if (stageScrollRef.value && stageScrollRef.value.scrollTop !== nextScrollTop) {
    stageScrollRef.value.scrollTop = nextScrollTop;
  }
};

const setActiveSide = (side: ScrollSide | null) => {
  activeSide.value = side;
};
</script>

<template>
  <div class="text-diff-page flex h-full flex-col gap-6 overflow-auto p-6">
    <section class="text-diff-panel flex flex-col gap-4 p-5">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold">{{ t('tools.text_diff.title') }}</h1>
        <p class="text-sm text-diff-muted">{{ t('tools.text_diff.description') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-4 text-sm text-diff-muted">
        <label class="flex items-center gap-2">
          <input v-model="ignoreWhitespace" type="checkbox" />
          <span>{{ t('tools.text_diff.ignore_whitespace') }}</span>
        </label>
        <label class="flex items-center gap-2">
          <input v-model="ignoreCase" type="checkbox" />
          <span>{{ t('tools.text_diff.ignore_case') }}</span>
        </label>
        <button type="button" data-testid="swap-button" class="text-diff-action rounded-lg px-3 py-2" @click="swapTexts">
          {{ t('tools.text_diff.swap') }}
        </button>
        <button type="button" class="text-diff-action rounded-lg px-3 py-2" @click="clearTexts">
          {{ t('tools.text_diff.clear') }}
        </button>
      </div>
    </section>

    <section
      data-testid="text-diff-workspace"
      class="text-diff-workspace grid min-h-[520px] gap-4 lg:grid-cols-2"
    >
      <div data-testid="text-diff-stage" class="text-diff-stage lg:col-span-2">
        <div class="text-diff-stage__headers">
          <header class="text-diff-stage__header">
            <span>{{ t('tools.text_diff.left_title') }}</span>
          </header>
          <header class="text-diff-stage__header">
            <span>{{ t('tools.text_diff.right_title') }}</span>
          </header>
        </div>

        <div class="text-diff-stage__canvas">
          <div
            v-if="hasInput"
            ref="stageScrollRef"
            data-testid="text-diff-shared-lines"
            class="text-diff-shared-lines text-diff-stage__scroll-layer"
          >
            <div
              v-for="(line, index) in diffLines"
              :key="`${index}-${line.leftLineNumber}-${line.rightLineNumber}`"
              data-testid="diff-line-row"
              :data-line-type="line.type"
              class="diff-line-row"
              :class="{
                'is-equal': line.type === 'equal',
                'is-remove': line.type === 'remove',
                'is-add': line.type === 'add',
                'is-modify': line.type === 'modify',
              }"
            >
              <div
                data-testid="diff-line-left-cell"
                class="diff-line-cell"
                :class="{
                  'is-placeholder': line.leftPlaceholder,
                  'is-muted-by-input': activeSide === 'left' && !line.leftPlaceholder,
                }"
              >
                <span class="diff-line-number">{{ line.leftLineNumber ?? '' }}</span>
                <span v-if="line.leftPlaceholder" data-testid="left-placeholder" class="diff-line-placeholder"></span>
                <template v-else-if="line.leftTokens?.length">
                  <span
                    v-for="(token, tokenIndex) in line.leftTokens"
                    :key="`left-${index}-${tokenIndex}`"
                    class="whitespace-pre-wrap"
                    :class="{ 'diff-token-remove': token.type === 'remove' }"
                  >{{ token.text }}</span>
                </template>
                <span v-else class="whitespace-pre-wrap break-words">{{ line.leftText || ' ' }}</span>
              </div>

              <div
                data-testid="diff-line-right-cell"
                class="diff-line-cell"
                :class="{
                  'is-placeholder': line.rightPlaceholder,
                  'is-muted-by-input': activeSide === 'right' && !line.rightPlaceholder,
                }"
              >
                <span class="diff-line-number">{{ line.rightLineNumber ?? '' }}</span>
                <span v-if="line.rightPlaceholder" data-testid="right-placeholder" class="diff-line-placeholder"></span>
                <template v-else-if="line.rightTokens?.length">
                  <span
                    v-for="(token, tokenIndex) in line.rightTokens"
                    :key="`right-${index}-${tokenIndex}`"
                    class="whitespace-pre-wrap"
                    :class="{ 'diff-token-add': token.type === 'add' }"
                  >{{ token.text }}</span>
                </template>
                <span v-else class="whitespace-pre-wrap break-words">{{ line.rightText || ' ' }}</span>
              </div>
            </div>
          </div>

          <div v-else class="text-diff-empty-state">
            <span>{{ t('tools.text_diff.empty_state') }}</span>
          </div>

          <div class="text-diff-stage__input-column text-diff-stage__input-column--left">
            <textarea
              ref="leftScrollRef"
              v-model="leftText"
              data-testid="text-diff-left-input"
              class="text-diff-stage__input diff-pane__scroll"
              :class="{
                'is-empty': !hasInput,
                'is-active': activeSide === 'left',
              }"
              :placeholder="t('tools.text_diff.left_placeholder')"
              @focus="setActiveSide('left')"
              @blur="setActiveSide(null)"
              @scroll="syncScroll('left')"
            />
          </div>

          <div class="text-diff-stage__input-column text-diff-stage__input-column--right">
            <textarea
              ref="rightScrollRef"
              v-model="rightText"
              data-testid="text-diff-right-input"
              class="text-diff-stage__input diff-pane__scroll"
              :class="{
                'is-empty': !hasInput,
                'is-active': activeSide === 'right',
              }"
              :placeholder="t('tools.text_diff.right_placeholder')"
              @focus="setActiveSide('right')"
              @blur="setActiveSide(null)"
              @scroll="syncScroll('right')"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.text-diff-page {
  color: var(--skin-text-main);
}

.text-diff-panel {
  border-radius: 1rem;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-strong);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft);
}

.text-diff-muted {
  color: var(--skin-text-muted);
}

.text-diff-action {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-main);
  transition: all 0.2s ease;
}

.text-diff-action:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.4);
  color: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.text-diff-workspace {
  align-content: start;
  --diff-bg: var(--skin-panel-bg);
  --diff-border: var(--skin-border);
  --diff-header-fg: var(--skin-text-main);
  --diff-editor-bg: rgba(var(--skin-accent-rgb) / 0.03);
  --diff-editor-fg: var(--skin-text-strong);
  --diff-cell-bg: var(--skin-panel-bg);
  --diff-cell-fg: var(--skin-text-strong);
  --diff-muted: var(--skin-text-muted);
  --diff-placeholder: rgba(var(--skin-accent-rgb) / 0.12);
  --diff-line-equal: rgba(var(--skin-accent-rgb) / 0.02);
  --diff-line-add: rgba(16, 185, 129, 0.1);
  --diff-line-add-border: rgba(16, 185, 129, 0.35);
  --diff-line-remove: rgba(239, 68, 68, 0.1);
  --diff-line-remove-border: rgba(239, 68, 68, 0.35);
  --diff-line-modify: rgba(59, 130, 246, 0.1);
  --diff-line-modify-border: rgba(59, 130, 246, 0.35);
  --diff-token-remove-bg: rgba(239, 68, 68, 0.25);
  --diff-token-remove-fg: rgb(185, 28, 28);
  --diff-token-add-bg: rgba(16, 185, 129, 0.25);
  --diff-token-add-fg: rgb(5, 120, 80);
  --diff-empty-bg: rgba(var(--skin-accent-rgb) / 0.03);
  --diff-empty-border: var(--skin-border);
  --diff-shadow: var(--skin-glow-soft);
}

:global(html.dark) .text-diff-workspace {
  --diff-line-add: rgba(16, 185, 129, 0.18);
  --diff-line-add-border: rgba(16, 185, 129, 0.45);
  --diff-line-remove: rgba(239, 68, 68, 0.18);
  --diff-line-remove-border: rgba(239, 68, 68, 0.45);
  --diff-line-modify: rgba(59, 130, 246, 0.18);
  --diff-line-modify-border: rgba(59, 130, 246, 0.45);
  --diff-token-remove-bg: rgba(190, 24, 93, 0.3);
  --diff-token-remove-fg: rgb(254, 205, 211);
  --diff-token-add-bg: rgba(5, 150, 105, 0.3);
  --diff-token-add-fg: rgb(167, 243, 208);
  --diff-placeholder: rgba(var(--skin-accent-rgb) / 0.18);
}

.text-diff-stage {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--diff-border);
  border-radius: 1rem;
  background: var(--diff-bg);
  box-shadow: var(--diff-shadow);
  overflow: hidden;
}

.text-diff-stage__headers {
  display: grid;
  gap: 1px;
  border-bottom: 1px solid var(--diff-border);
  background: var(--diff-border);
}

@media (min-width: 1024px) {
  .text-diff-stage__headers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.text-diff-stage__header {
  padding: 1rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--diff-header-fg);
  background: var(--diff-bg);
}

.text-diff-stage__canvas {
  position: relative;
  min-height: 460px;
}

.text-diff-stage__canvas::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-0.5px);
  background: var(--diff-border);
  pointer-events: none;
}

.text-diff-stage__scroll-layer {
  min-height: 460px;
  height: 100%;
  padding: 1rem;
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}

.diff-pane__scroll {
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}

.text-diff-stage__input-column {
  position: absolute;
  inset-block: 0;
  width: 50%;
  padding: 1rem;
}

.text-diff-stage__input-column--left {
  left: 0;
  padding-right: 0.5rem;
}

.text-diff-stage__input-column--right {
  right: 0;
  padding-left: 0.5rem;
}

.text-diff-stage__input {
  width: 100%;
  height: 100%;
  min-height: 428px;
  resize: none;
  border: none;
  border-radius: 0.75rem;
  padding: 0.875rem 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  color: transparent;
  -webkit-text-fill-color: transparent;
  caret-color: var(--diff-editor-fg);
  background: transparent;
  opacity: 0.01;
  transition: opacity 0.15s ease;
}

.text-diff-stage__input::placeholder {
  color: transparent;
}

.text-diff-stage__input.is-empty {
  color: var(--diff-editor-fg);
  -webkit-text-fill-color: var(--diff-editor-fg);
  opacity: 1;
}

.text-diff-stage__input.is-active {
  color: var(--diff-editor-fg);
  -webkit-text-fill-color: var(--diff-editor-fg);
  opacity: 1;
  background: color-mix(in srgb, var(--diff-editor-bg) 92%, transparent);
}

.text-diff-stage__input.is-empty::placeholder {
  color: var(--diff-muted);
}

.text-diff-stage__input:focus {
  outline: none;
}

.text-diff-shared-lines {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.diff-line-row {
  display: grid;
  gap: 0.75rem;
  border: 1px solid var(--diff-border);
  border-radius: 1rem;
  padding: 0.75rem;
}

@media (min-width: 1024px) {
  .diff-line-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.diff-line-row.is-equal {
  background: var(--diff-line-equal);
}

.diff-line-row.is-remove {
  background: var(--diff-line-remove);
  border-color: var(--diff-line-remove-border);
}

.diff-line-row.is-add {
  background: var(--diff-line-add);
  border-color: var(--diff-line-add-border);
}

.diff-line-row.is-modify {
  background: var(--diff-line-modify);
  border-color: var(--diff-line-modify-border);
}

.diff-line-cell {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: 0.75rem;
  min-width: 0;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  background: var(--diff-cell-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--diff-cell-fg);
}

.diff-line-cell.is-placeholder {
  color: var(--diff-muted);
}

.diff-line-cell.is-muted-by-input {
  opacity: 0;
}

.diff-line-number {
  font-size: 0.75rem;
  color: var(--diff-muted);
}

.diff-line-placeholder {
  display: block;
  min-height: 1.5rem;
  border-radius: 9999px;
  background: var(--diff-placeholder);
}

.diff-token-remove {
  background: var(--diff-token-remove-bg);
  color: var(--diff-token-remove-fg);
}

.diff-token-add {
  background: var(--diff-token-add-bg);
  color: var(--diff-token-add-fg);
}

.text-diff-empty-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 2rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--skin-text-muted);
  pointer-events: none;
  z-index: 1;
}
</style>
