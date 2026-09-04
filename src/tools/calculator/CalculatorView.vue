<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Delete, Equal } from 'lucide-vue-next';
import {
  createCalculatorEngine,
  type CalculatorHistoryItem,
  type CalculatorMode,
  type CalculatorResultStatus,
} from './engine';

const BASIC_KEYS = [
  'AC', '(', ')', '/',
  '7', '8', '9', '*',
  '4', '5', '6', '-',
  '1', '2', '3', '+',
  '+/-', '0', '.', '=',
];

const SCIENTIFIC_KEYS = ['sin(', 'cos(', 'tan(', 'sqrt(', '^', 'pi', '%'];

const { t } = useI18n();

// 计算器状态为组件本地（组件经 keep-alive 保活），不再占用全局 store。
const calculatorMode = ref<CalculatorMode>('basic');
const calculatorExpression = ref('');
const calculatorDisplay = ref('0');
const calculatorStatus = ref<CalculatorResultStatus>('value');
const calculatorHistory = ref<CalculatorHistoryItem[]>([]);

const engine = createCalculatorEngine({
  mode: calculatorMode.value,
  expression: calculatorExpression.value,
  display: calculatorDisplay.value,
  status: calculatorStatus.value,
  history: calculatorHistory.value,
});

const rootRef = ref<HTMLElement | null>(null);

const syncFromEngine = () => {
  const state = engine.getState();
  calculatorMode.value = state.mode;
  calculatorExpression.value = state.expression;
  calculatorDisplay.value = state.display;
  calculatorStatus.value = state.status;
  calculatorHistory.value = state.history;
};

const displayExpression = computed(() => calculatorExpression.value || '0');
const displayResult = computed(() => calculatorDisplay.value || '0');
const currentMode = computed(() => calculatorMode.value);
const setMode = (mode: CalculatorMode) => {
  engine.setMode(mode);
  syncFromEngine();
};

const handleToken = (token: string) => {
  if (token === 'AC') {
    engine.clear();
  } else if (token === '=') {
    engine.evaluate();
  } else {
    engine.input(token);
  }
  syncFromEngine();
};

const handleBackspace = () => {
  engine.backspace();
  syncFromEngine();
};

const handleHistoryClick = (id: string) => {
  engine.recallHistoryResult(id);
  syncFromEngine();
};

const handleKeydown = (event: KeyboardEvent) => {
  const key = event.key;

  if (/^\d$/.test(key)) {
    event.preventDefault();
    handleToken(key);
    return;
  }

  if (['+', '-', '*', '/', '(', ')', '^', '.'].includes(key)) {
    event.preventDefault();
    handleToken(key);
    return;
  }

  if (key === 'Enter' || key === '=') {
    event.preventDefault();
    handleToken('=');
    return;
  }

  if (key === 'Backspace') {
    event.preventDefault();
    handleBackspace();
    return;
  }

  if (key === 'Delete' || key.toLowerCase() === 'c') {
    event.preventDefault();
    handleToken('AC');
  }
};

onMounted(() => {
  syncFromEngine();
  rootRef.value?.focus();
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div
    ref="rootRef"
    class="calc-page h-full overflow-auto outline-none"
    tabindex="0"
  >
    <div class="mx-auto flex h-full max-w-6xl flex-col gap-6 p-4 lg:flex-row">
      <section class="calc-panel flex min-h-[640px] flex-1 flex-col rounded-3xl p-4">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="calc-title text-xs uppercase tracking-[0.24em]">{{ t('tools.calculator.title') }}</div>
            <div class="mt-1 text-sm calc-subtitle">{{ t('tools.calculator.subtitle') }}</div>
          </div>
          <div class="calc-mode-switch inline-flex rounded-full p-1">
            <button
              data-mode="basic"
              :data-active="currentMode === 'basic' ? 'true' : 'false'"
              class="calc-mode-btn rounded-full px-4 py-2 text-sm transition"
              :class="currentMode === 'basic' ? 'is-active' : ''"
              @click="setMode('basic')"
            >
              {{ t('tools.calculator.mode_basic') }}
            </button>
            <button
              data-mode="scientific"
              :data-active="currentMode === 'scientific' ? 'true' : 'false'"
              class="calc-mode-btn rounded-full px-4 py-2 text-sm transition"
              :class="currentMode === 'scientific' ? 'is-active' : ''"
              @click="setMode('scientific')"
            >
              {{ t('tools.calculator.mode_scientific') }}
            </button>
          </div>
        </div>

        <div class="calc-display mb-4 rounded-3xl px-5 py-4">
          <div
            data-display-expression
            class="calc-expression min-h-[28px] break-all text-right font-mono text-sm"
          >
            {{ displayExpression }}
          </div>
          <div
            data-display-result
            class="mt-3 break-all text-right font-mono text-4xl font-semibold"
            :class="calculatorStatus === 'error' ? 'calc-result-error' : 'calc-result'"
          >
            {{ displayResult }}
          </div>
        </div>

        <div class="mb-3 flex items-center justify-between text-xs calc-hint">
          <span>{{ t('tools.calculator.keyboard_hint') }}</span>
          <button
            class="calc-backspace inline-flex items-center gap-2 rounded-full px-3 py-1.5"
            @click="handleBackspace"
          >
            <Delete class="h-4 w-4" />
            <span>{{ t('tools.calculator.backspace') }}</span>
          </button>
        </div>

        <div
          v-if="currentMode === 'scientific'"
          data-scientific-grid
          class="mb-3 grid grid-cols-4 gap-3 lg:grid-cols-7"
        >
          <button
            v-for="token in SCIENTIFIC_KEYS"
            :key="`scientific-${token}`"
            :data-key="token"
            class="calc-key calc-key-scientific rounded-2xl px-3 py-4 text-base font-medium transition"
            @click="handleToken(token)"
          >
            {{ token }}
          </button>
        </div>

        <div data-basic-grid class="grid flex-1 grid-cols-4 gap-3">
          <button
            v-for="token in BASIC_KEYS"
            :key="token"
            :data-key="token"
            class="calc-key rounded-2xl px-3 py-4 text-base font-medium transition"
            :class="{
              'calc-key-equals': token === '=',
              'calc-key-op': ['AC', '+/-', '%', '/', '*', '-', '+', '^'].includes(token) || token.endsWith('(') || token === 'pi',
              'calc-key-num': !(['AC', '+/-', '%', '/', '*', '-', '+', '^'].includes(token) || token.endsWith('(') || token === 'pi' || token === '='),
            }"
            @click="handleToken(token)"
          >
            <span v-if="token === '='"><Equal class="mx-auto h-5 w-5" /></span>
            <span v-else>{{ token }}</span>
          </button>
        </div>
      </section>

      <aside class="calc-history w-full rounded-3xl p-4 lg:w-[320px]">
        <div class="flex items-center justify-between">
          <div>
            <div class="calc-history-title text-xs uppercase tracking-[0.24em]">{{ t('tools.calculator.history_title') }}</div>
            <div class="mt-1 text-sm calc-subtitle">{{ t('tools.calculator.history_hint') }}</div>
          </div>
          <span class="calc-history-count rounded-full px-3 py-1 text-xs">{{ calculatorHistory.length }}/10</span>
        </div>

        <div class="mt-4 flex flex-col gap-3">
          <button
            v-for="item in calculatorHistory"
            :key="item.id"
            data-history-item
            class="calc-history-item rounded-2xl p-3 text-left transition"
            @click="handleHistoryClick(item.id)"
          >
            <div class="truncate font-mono text-xs calc-hint">{{ item.expression }}</div>
            <div class="mt-2 truncate font-mono text-lg calc-result">{{ item.result }}</div>
          </button>
          <div
            v-if="calculatorHistory.length === 0"
            class="calc-history-empty rounded-2xl border border-dashed px-4 py-8 text-center text-sm"
          >
            {{ t('tools.calculator.history_empty') }}
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.calc-page {
  background: transparent;
  color: var(--skin-text-main);
}

.calc-panel {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  box-shadow: var(--skin-glow);
}

.calc-title {
  color: var(--skin-accent);
  font-family: "Consolas", "SF Mono", monospace;
  text-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.4);
}

.calc-subtitle {
  color: var(--skin-text-muted);
}

.calc-mode-switch {
  border: 1px solid var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.06);
}

.calc-mode-btn {
  color: var(--skin-text-muted);
  font-weight: 600;
}

.calc-mode-btn.is-active {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2));
  color: white;
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.3);
}

.calc-display {
  border: 1px solid var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.03);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.06);
}

.calc-expression {
  color: var(--skin-text-muted);
}

.calc-result {
  color: var(--skin-text-strong);
}

.calc-result-error {
  color: #ef4444;
  text-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.calc-hint {
  color: var(--skin-text-muted);
}

.calc-backspace {
  border: 1px solid var(--skin-border);
  color: var(--skin-text-muted);
  transition: all 0.2s ease;
}

.calc-backspace:hover {
  border-color: var(--skin-accent);
  color: var(--skin-accent);
}

.calc-key {
  border: 1px solid var(--skin-border);
  transition: all 0.15s ease;
}

.calc-key:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.4);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.calc-key-scientific {
  background: rgba(var(--skin-accent-rgb) / 0.08);
  color: var(--skin-accent);
  font-family: "Consolas", "SF Mono", monospace;
}

.calc-key-scientific:hover {
  background: rgba(var(--skin-accent-rgb) / 0.15);
}

.calc-key-op {
  background: rgba(var(--skin-accent-rgb) / 0.12);
  color: var(--skin-accent);
  font-weight: 700;
}

.calc-key-op:hover {
  background: rgba(var(--skin-accent-rgb) / 0.2);
}

.calc-key-num {
  background: var(--skin-panel-bg);
  color: var(--skin-text-strong);
}

.calc-key-num:hover {
  background: rgba(var(--skin-accent-rgb) / 0.06);
}

.calc-key-equals {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2));
  color: white;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.3);
}

.calc-key-equals:hover {
  box-shadow: 0 6px 20px rgba(var(--skin-accent-rgb) / 0.4), 0 0 16px rgba(var(--skin-accent-rgb) / 0.2);
}

.calc-history {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  box-shadow: var(--skin-glow-soft);
}

.calc-history-title {
  color: #10b981;
  font-family: "Consolas", "SF Mono", monospace;
}

:global(html.dark) .calc-history-title {
  color: #34d399;
  text-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
}

.calc-history-count {
  background: rgba(var(--skin-accent-rgb) / 0.1);
  color: var(--skin-text-muted);
}

.calc-history-item {
  border: 1px solid var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.03);
  transition: all 0.2s ease;
}

.calc-history-item:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.4);
  background: rgba(var(--skin-accent-rgb) / 0.06);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.calc-history-empty {
  border-color: var(--skin-border);
  color: var(--skin-text-muted);
}
</style>
