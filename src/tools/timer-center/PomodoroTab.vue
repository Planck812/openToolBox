<script setup lang="ts">
/**
 * 番茄钟 tab：阶段进度 + 参数配置 + 开始/暂停/跳过/重置本轮。
 *
 * 后端为权威计时源（阶段机在 Rust 侧），本页一次性 invoke 拿剩余秒 + 本地
 * setInterval 递减做平滑显示；阶段切换由后端弹窗提示。
 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Coffee, Pause, Play, RotateCcw, Save, SkipForward } from 'lucide-vue-next';
import {
  timerGetPomodoro,
  timerPausePomodoro,
  timerResetPomodoro,
  timerSetPomodoroConfig,
  timerSkipPhase,
  timerStartPomodoro,
  type PomodoroConfig,
  type PomodoroState,
} from '@/lib/ipc/timer';

const { t } = useI18n();
const store = useAppStore();

const config = ref<PomodoroConfig>({
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  intervalForLongBreak: 4,
});
const state = ref<PomodoroState>({
  running: false,
  phase: 'work',
  secondsLeft: 25 * 60,
  workCount: 0,
  inRound: 0,
  phaseStartAt: null,
  awaitingNext: false,
});

/** 本地平滑显示剩余秒。 */
const displaySeconds = ref(0);
const loading = ref(true);
const errorMessage = ref('');
const saving = ref(false);

let ticker: ReturnType<typeof setInterval> | null = null;

const PHASE_KEYS: Record<string, string> = {
  work: 'tools.timer_center.phase_work',
  short_break: 'tools.timer_center.phase_short_break',
  long_break: 'tools.timer_center.phase_long_break',
};

const phaseLabel = (phase: string): string => {
  const key = PHASE_KEYS[phase];
  return key ? t(key) : phase;
};

const isRunning = (): boolean => state.value.running;

const formatDuration = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const startTicker = () => {
  if (ticker) return;
  ticker = setInterval(() => {
    if (isRunning()) {
      displaySeconds.value = Math.max(0, displaySeconds.value - 1);
      // 到 0 时重新同步：后端可能已切换阶段（避免显示停留在 00:00）。
      if (displaySeconds.value === 0) {
        void loadPomodoro();
      }
    }
  }, 1000);
};

const stopTicker = () => {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
};

const syncFromBackend = (st: PomodoroState) => {
  state.value = st;
  displaySeconds.value = st.secondsLeft;
  if (st.running) startTicker();
  else stopTicker();
};

const loadPomodoro = async () => {
  try {
    const res = await timerGetPomodoro();
    config.value = res.config;
    syncFromBackend(res.state);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 开始 / 继续。 */
const start = async () => {
  try {
    await timerStartPomodoro();
    await loadPomodoro();
    startTicker();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 暂停。 */
const pause = async () => {
  try {
    await timerPausePomodoro();
    stopTicker();
    await loadPomodoro();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 跳过当前阶段。 */
const skip = async () => {
  try {
    await timerSkipPhase();
    await loadPomodoro();
    startTicker();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 重置本轮（回到工作阶段、暂停态，保留累计次数）。 */
const resetRound = async () => {
  try {
    await timerResetPomodoro();
    stopTicker();
    await loadPomodoro();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 保存配置。 */
const saveConfig = async () => {
  saving.value = true;
  try {
    await timerSetPomodoroConfig({
      workMinutes: Number(config.value.workMinutes),
      shortBreakMinutes: Number(config.value.shortBreakMinutes),
      longBreakMinutes: Number(config.value.longBreakMinutes),
      intervalForLongBreak: Number(config.value.intervalForLongBreak),
    });
    await loadPomodoro();
    store.showToast(t('tools.timer_center.saved'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  await loadPomodoro();
  loading.value = false;
});

onActivated(() => {
  void loadPomodoro();
});

onDeactivated(() => {
  stopTicker();
});

onBeforeUnmount(() => {
  stopTicker();
});
</script>

<template>
  <div>
    <div v-if="errorMessage" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="py-8 text-center text-sm text-muted-foreground">
      {{ t('tools.timer_center.loading') }}
    </div>
    <template v-else>
      <!-- 阶段进度 -->
      <div class="mb-5 rounded-xl border border-border bg-muted/40 p-6 text-center">
        <div class="flex items-center justify-center gap-2">
          <Coffee v-if="state.phase !== 'work'" class="h-5 w-5 text-primary" />
          <span class="text-lg font-semibold">{{ phaseLabel(state.phase) }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="state.running ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            {{ state.running
              ? t('tools.timer_center.pomodoro_running')
              : t('tools.timer_center.pomodoro_paused') }}
          </span>
        </div>
        <p class="mt-3 text-5xl font-bold tabular-nums">
          {{ formatDuration(displaySeconds) }}
        </p>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ t('tools.timer_center.pomodoro_work_count', { count: state.workCount }) }}
          · {{ t('tools.timer_center.pomodoro_round', { count: state.inRound, interval: config.intervalForLongBreak }) }}
        </p>

        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button
            v-if="!isRunning()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="start"
          >
            <Play class="h-4 w-4" />
            {{ t('tools.timer_center.pomodoro_start') }}
          </button>
          <button
            v-else
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="pause"
          >
            <Pause class="h-4 w-4" />
            {{ t('tools.timer_center.pomodoro_pause') }}
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            :disabled="!isRunning()"
            @click="skip"
          >
            <SkipForward class="h-4 w-4" />
            {{ t('tools.timer_center.pomodoro_skip') }}
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            @click="resetRound"
          >
            <RotateCcw class="h-4 w-4" />
            {{ t('tools.timer_center.pomodoro_reset') }}
          </button>
        </div>
      </div>

      <!-- 参数配置 -->
      <div class="rounded-xl border border-border p-4">
        <h4 class="mb-3 text-sm font-semibold">{{ t('tools.timer_center.pomodoro_config_title') }}</h4>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.pomodoro_work') }}</span>
            <div class="flex items-center gap-1.5">
              <input
                v-model.number="config.workMinutes"
                type="number"
                min="1"
                max="180"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span class="text-xs text-muted-foreground">{{ t('tools.timer_center.minutes_unit') }}</span>
            </div>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.pomodoro_short_break') }}</span>
            <div class="flex items-center gap-1.5">
              <input
                v-model.number="config.shortBreakMinutes"
                type="number"
                min="1"
                max="120"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span class="text-xs text-muted-foreground">{{ t('tools.timer_center.minutes_unit') }}</span>
            </div>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.pomodoro_long_break') }}</span>
            <div class="flex items-center gap-1.5">
              <input
                v-model.number="config.longBreakMinutes"
                type="number"
                min="1"
                max="180"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span class="text-xs text-muted-foreground">{{ t('tools.timer_center.minutes_unit') }}</span>
            </div>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.pomodoro_interval') }}</span>
            <div class="flex items-center gap-1.5">
              <input
                v-model.number="config.intervalForLongBreak"
                type="number"
                min="2"
                max="12"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span class="text-xs text-muted-foreground">{{ t('tools.timer_center.pomodoro_round_unit') }}</span>
            </div>
          </label>
        </div>
        <div class="mt-4 flex justify-end">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="saving"
            @click="saveConfig"
          >
            <Save class="h-4 w-4" />
            {{ saving ? t('tools.timer_center.saving') : t('tools.timer_center.save') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
