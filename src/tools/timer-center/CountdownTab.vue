<script setup lang="ts">
/**
 * 倒计时 tab：时长设置 + 预设快捷启动 + 启动/暂停/继续/重置/取消 + 运行态显示。
 *
 * 后端为权威计时源；本页用一次性 invoke 拿剩余秒 + 本地 setInterval 递减做平滑显示
 * （避免每秒 invoke 开销）。暂停/继续时重新与后端同步。
 */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Pause, Play, Plus, RotateCcw, Trash2, X } from 'lucide-vue-next';
import {
  timerAddPreset,
  timerCancelCountdown,
  timerGetCountdown,
  timerGetPresets,
  timerPauseCountdown,
  timerRemovePreset,
  timerResumeCountdown,
  timerStartCountdown,
  type Countdown,
  type CountdownPreset,
} from '@/lib/ipc/timer';

const { t } = useI18n();
const store = useAppStore();

/** 运行中/暂停中的倒计时（后端返回）。 */
const countdown = ref<Countdown | null>(null);
/** 本地平滑显示剩余秒。 */
const displayRemaining = ref(0);
/** 预设列表。 */
const presets = ref<CountdownPreset[]>([]);

/** 输入：分钟 + 秒。 */
const minutes = ref(25);
const seconds = ref(0);
/** 倒计时名称（可选）。 */
const countdownName = ref('');
/** 新增预设输入。 */
const presetSeconds = ref(300);
const presetName = ref('');

const loading = ref(true);
const errorMessage = ref('');

let ticker: ReturnType<typeof setInterval> | null = null;

const formatDuration = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const isRunning = (): boolean => !!countdown.value && countdown.value.startAt !== null;

const startTicker = () => {
  if (ticker) return;
  ticker = setInterval(() => {
    if (isRunning()) {
      displayRemaining.value = Math.max(0, displayRemaining.value - 1);
      // 到 0 时重新同步：后端可能已到点移除实例（避免停留在 00:00）。
      if (displayRemaining.value === 0) {
        void loadCountdown();
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

const syncFromBackend = (cd: Countdown | null) => {
  countdown.value = cd;
  displayRemaining.value = cd ? cd.remainingSeconds : 0;
};

const loadCountdown = async () => {
  try {
    const cd = await timerGetCountdown();
    syncFromBackend(cd);
    if (cd && cd.startAt !== null) startTicker();
    else stopTicker();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

const loadPresets = async () => {
  try {
    presets.value = await timerGetPresets();
  } catch {
    // 预设读取失败忽略。
  }
};

const inputTotalSeconds = (): number => {
  const m = Number(minutes.value) || 0;
  const s = Number(seconds.value) || 0;
  return m * 60 + s;
};

/** 启动倒计时。 */
const startCountdown = async () => {
  const total = inputTotalSeconds();
  if (total <= 0) {
    store.showToast(t('tools.timer_center.countdown_invalid'), { type: 'error' });
    return;
  }
  try {
    const cd = await timerStartCountdown({
      name: countdownName.value,
      totalSeconds: total,
    });
    syncFromBackend(cd);
    startTicker();
    store.showToast(t('tools.timer_center.countdown_started'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 暂停。 */
const pauseCountdown = async () => {
  try {
    await timerPauseCountdown();
    stopTicker();
    await loadCountdown();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 继续。 */
const resumeCountdown = async () => {
  try {
    await timerResumeCountdown();
    await loadCountdown();
    startTicker();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 重置：取消当前并回到输入时长（保留总时长到输入框）。 */
const resetCountdown = async () => {
  try {
    const total = countdown.value?.totalSeconds ?? 0;
    await timerCancelCountdown();
    stopTicker();
    countdown.value = null;
    displayRemaining.value = 0;
    if (total > 0) {
      minutes.value = Math.floor(total / 60);
      seconds.value = total % 60;
    }
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 取消（清空运行态）。 */
const cancelCountdown = async () => {
  try {
    await timerCancelCountdown();
    stopTicker();
    countdown.value = null;
    displayRemaining.value = 0;
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 预设一键启动。 */
const startPreset = async (preset: CountdownPreset) => {
  try {
    const cd = await timerStartCountdown({
      name: preset.name,
      totalSeconds: preset.seconds,
    });
    syncFromBackend(cd);
    startTicker();
    store.showToast(t('tools.timer_center.countdown_started'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 新增自定义预设。 */
const addPreset = async () => {
  const total = Number(presetSeconds.value) || 0;
  if (total <= 0) {
    store.showToast(t('tools.timer_center.preset_invalid'), { type: 'error' });
    return;
  }
  try {
    await timerAddPreset({ seconds: total, name: presetName.value });
    presetName.value = '';
    await loadPresets();
    store.showToast(t('tools.timer_center.preset_added'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 删除预设。 */
const removePreset = async (id: string) => {
  try {
    await timerRemovePreset(id);
    await loadPresets();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

onMounted(async () => {
  loading.value = true;
  await Promise.all([loadCountdown(), loadPresets()]);
  loading.value = false;
});

onActivated(() => {
  void loadCountdown();
  void loadPresets();
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
      <!-- 运行态 -->
      <div class="mb-5 rounded-xl border border-border bg-muted/40 p-5 text-center">
        <p class="text-xs text-muted-foreground">
          {{ countdown ? t('tools.timer_center.countdown_status') : t('tools.timer_center.countdown_idle') }}
        </p>
        <p v-if="countdown" class="mt-1 text-4xl font-bold tabular-nums">
          {{ formatDuration(displayRemaining) }}
        </p>
        <p v-else class="mt-1 text-4xl font-bold tabular-nums text-muted-foreground/40">
          {{ formatDuration(inputTotalSeconds()) }}
        </p>
        <p v-if="countdown" class="mt-1 text-xs text-muted-foreground">
          <template v-if="countdown.name">{{ countdown.name }} · </template>
          {{ t('tools.timer_center.countdown_total') }} {{ formatDuration(countdown.totalSeconds) }}
          <template v-if="!isRunning()"> · {{ t('tools.timer_center.countdown_paused') }}</template>
        </p>

        <div class="mt-4 flex flex-wrap justify-center gap-2">
          <template v-if="!countdown">
            <button
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              @click="startCountdown"
            >
              <Play class="h-4 w-4" />
              {{ t('tools.timer_center.countdown_start') }}
            </button>
          </template>
          <template v-else>
            <button
              v-if="isRunning()"
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              @click="pauseCountdown"
            >
              <Pause class="h-4 w-4" />
              {{ t('tools.timer_center.countdown_pause') }}
            </button>
            <button
              v-else
              class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              @click="resumeCountdown"
            >
              <Play class="h-4 w-4" />
              {{ t('tools.timer_center.countdown_resume') }}
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              @click="resetCountdown"
            >
              <RotateCcw class="h-4 w-4" />
              {{ t('tools.timer_center.countdown_reset') }}
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              @click="cancelCountdown"
            >
              <X class="h-4 w-4" />
              {{ t('tools.timer_center.countdown_cancel') }}
            </button>
          </template>
        </div>
      </div>

      <!-- 自定义时长 -->
      <div class="mb-5 rounded-xl border border-border p-4">
        <h4 class="mb-3 text-sm font-semibold">{{ t('tools.timer_center.countdown_custom') }}</h4>
        <div class="flex flex-wrap items-end gap-3">
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.countdown_minutes') }}</span>
            <input
              v-model.number="minutes"
              type="number"
              min="0"
              class="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.countdown_seconds') }}</span>
            <input
              v-model.number="seconds"
              type="number"
              min="0"
              max="59"
              class="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label class="block flex-1 min-w-40">
            <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.countdown_name') }}</span>
            <input
              v-model="countdownName"
              type="text"
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              :placeholder="t('tools.timer_center.countdown_name_placeholder')"
            />
          </label>
          <button
            class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="startCountdown"
          >
            {{ t('tools.timer_center.countdown_start') }}
          </button>
        </div>
      </div>

      <!-- 预设 -->
      <div class="rounded-xl border border-border p-4">
        <h4 class="mb-3 text-sm font-semibold">{{ t('tools.timer_center.preset_title') }}</h4>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            @click="startPreset(preset)"
          >
            {{ preset.name || formatDuration(preset.seconds) }}
          </button>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <input
            v-model.number="presetSeconds"
            type="number"
            min="1"
            class="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            :placeholder="t('tools.timer_center.preset_seconds_placeholder')"
          />
          <input
            v-model="presetName"
            type="text"
            class="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            :placeholder="t('tools.timer_center.preset_name_placeholder')"
          />
          <button
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="addPreset"
          >
            <Plus class="h-4 w-4" />
            {{ t('tools.timer_center.preset_add') }}
          </button>
        </div>

        <div v-if="presets.length > 0" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :title="t('tools.timer_center.delete')"
            @click="removePreset(preset.id)"
          >
            {{ preset.name || formatDuration(preset.seconds) }}
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
