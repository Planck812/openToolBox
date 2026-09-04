<script setup lang="ts">
/**
 * 秒表 tab：纯前端实现，不涉后端、不持久化、不写历史。
 *
 * `performance.now()` 差值计时，精度 0.01s；计次记录每圈耗时 + 累计耗时。
 */
import { onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Flag, Pause, Play, RotateCcw } from 'lucide-vue-next';

interface Lap {
  index: number;
  /** 该圈耗时（ms）。 */
  splitMs: number;
  /** 累计耗时（ms）。 */
  totalMs: number;
}

const { t } = useI18n();

const running = ref(false);
/** 累计经过毫秒（不含当前进行中的分段）。 */
const elapsedMs = ref(0);
/** 最近一次开始/继续的时刻。 */
let startAt = 0;
/** 计次列表。 */
const laps = ref<Lap[]>([]);

/** 是否处于激活态（keep-alive 缓存下可被停用）。 */
const isActive = ref(true);

let rafId: number | null = null;

/** 当前显示毫秒 = 已累计 + 运行中的增量。 */
const currentMs = (): number => {
  if (!running.value) return elapsedMs.value;
  const delta = performance.now() - startAt;
  return elapsedMs.value + delta;
};

const formatMs = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms));
  const cs = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${ss}.${cc}`;
};

/** 渲染用响应式字符串（由 rAF 更新）。 */
const display = ref(formatMs(0));

const tick = () => {
  display.value = formatMs(currentMs());
  rafId = requestAnimationFrame(tick);
};

const stopLoop = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
};

const start = () => {
  if (running.value) return;
  startAt = performance.now();
  running.value = true;
  if (isActive.value) tick();
};

const pause = () => {
  if (!running.value) return;
  elapsedMs.value = currentMs();
  running.value = false;
  stopLoop();
  display.value = formatMs(elapsedMs.value);
};

const reset = () => {
  running.value = false;
  stopLoop();
  elapsedMs.value = 0;
  laps.value = [];
  display.value = formatMs(0);
};

/** 计次：记录当前累计耗时与本次圈耗时。 */
const lap = () => {
  if (!running.value) return;
  const total = currentMs();
  const prevTotal = laps.value.length > 0 ? laps.value[laps.value.length - 1].totalMs : 0;
  laps.value.push({
    index: laps.value.length + 1,
    splitMs: total - prevTotal,
    totalMs: total,
  });
};

onActivated(() => {
  isActive.value = true;
  if (running.value) tick();
});

onDeactivated(() => {
  isActive.value = false;
  stopLoop();
});

onBeforeUnmount(() => {
  isActive.value = false;
  stopLoop();
});
</script>

<template>
  <div>
    <div class="rounded-xl border border-border bg-muted/40 p-6 text-center">
      <p class="text-5xl font-bold tabular-nums">{{ display }}</p>
      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <button
          v-if="!running"
          class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="start"
        >
          <Play class="h-4 w-4" />
          {{ t('tools.timer_center.stopwatch_start') }}
        </button>
        <button
          v-else
          class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="pause"
        >
          <Pause class="h-4 w-4" />
          {{ t('tools.timer_center.stopwatch_pause') }}
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!running"
          @click="lap"
        >
          <Flag class="h-4 w-4" />
          {{ t('tools.timer_center.stopwatch_lap') }}
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!running && elapsedMs === 0"
          @click="reset"
        >
          <RotateCcw class="h-4 w-4" />
          {{ t('tools.timer_center.stopwatch_reset') }}
        </button>
      </div>
    </div>

    <div class="mt-5">
      <h4 class="mb-2 text-sm font-semibold">
        {{ t('tools.timer_center.stopwatch_laps') }}
        <span v-if="laps.length > 0" class="text-xs font-normal text-muted-foreground">({{ laps.length }})</span>
      </h4>
      <div v-if="laps.length === 0" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('tools.timer_center.stopwatch_no_laps') }}
      </div>
      <div v-else class="overflow-hidden rounded-lg border border-border">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th class="px-3 py-2 text-left font-medium">{{ t('tools.timer_center.stopwatch_lap_index') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('tools.timer_center.stopwatch_lap_split') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('tools.timer_center.stopwatch_lap_total') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="item in [...laps].reverse()" :key="item.index">
              <td class="px-3 py-2">{{ t('tools.timer_center.stopwatch_lap_n', { n: item.index }) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatMs(item.splitMs) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatMs(item.totalMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
