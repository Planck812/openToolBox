<script setup lang="ts">
/**
 * 统计 tab：今日 / 本周 / 累计专注时长 + 最近记录列表（倒计时完成 + 番茄工作完成）。
 */
import { onActivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Trash2 } from 'lucide-vue-next';
import { timerClearHistory, timerGetHistory, type HistoryEntry } from '@/lib/ipc/timer';

const { t } = useI18n();
const store = useAppStore();

const history = ref<HistoryEntry[]>([]);
const loading = ref(true);
const errorMessage = ref('');

const todaySeconds = ref(0);
const weekSeconds = ref(0);
const totalSeconds = ref(0);

const formatDuration = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return t('common.duration_seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('common.duration_minutes', { n: m });
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0
    ? t('common.duration_hours_minutes', { n: h, m: rm })
    : t('common.duration_hours', { n: h });
};

const formatTime = (epochSecs: number): string => {
  const d = new Date(epochSecs * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const kindLabel = (kind: string): string =>
  kind === 'pomodoro'
    ? t('tools.timer_center.stats_kind_pomodoro')
    : t('tools.timer_center.stats_kind_countdown');

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
};

const startOfWeek = (): number => {
  const d = new Date();
  const diffToMonday = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diffToMonday);
  return d.getTime() / 1000;
};

const loadHistory = async (showLoading = true) => {
  if (showLoading) loading.value = true;
  errorMessage.value = '';
  try {
    history.value = await timerGetHistory();
    const today = startOfToday();
    const week = startOfWeek();
    todaySeconds.value = history.value
      .filter((h) => h.finishedAtEpochSecs >= today)
      .reduce((sum, h) => sum + h.seconds, 0);
    weekSeconds.value = history.value
      .filter((h) => h.finishedAtEpochSecs >= week)
      .reduce((sum, h) => sum + h.seconds, 0);
    totalSeconds.value = history.value.reduce((sum, h) => sum + h.seconds, 0);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  } finally {
    if (showLoading) loading.value = false;
  }
};

const clearHistory = async () => {
  try {
    await timerClearHistory();
    await loadHistory(false);
    store.showToast(t('tools.timer_center.stats_cleared'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

onMounted(async () => {
  await loadHistory();
});

onActivated(() => {
  void loadHistory(false);
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
      <div class="mb-5 grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-border bg-muted/40 p-4 text-center">
          <p class="text-xs text-muted-foreground">{{ t('tools.timer_center.stats_today') }}</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ formatDuration(todaySeconds) }}</p>
        </div>
        <div class="rounded-xl border border-border bg-muted/40 p-4 text-center">
          <p class="text-xs text-muted-foreground">{{ t('tools.timer_center.stats_week') }}</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ formatDuration(weekSeconds) }}</p>
        </div>
        <div class="rounded-xl border border-border bg-muted/40 p-4 text-center">
          <p class="text-xs text-muted-foreground">{{ t('tools.timer_center.stats_total') }}</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{{ formatDuration(totalSeconds) }}</p>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold">{{ t('tools.timer_center.stats_recent') }}</h4>
        <button
          v-if="history.length > 0"
          class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          @click="clearHistory"
        >
          <Trash2 class="h-3.5 w-3.5" />
          {{ t('tools.timer_center.stats_clear') }}
        </button>
      </div>

      <div v-if="history.length === 0" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('tools.timer_center.stats_empty') }}
      </div>
      <div v-else class="mt-2 overflow-hidden rounded-lg border border-border">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th class="px-3 py-2 text-left font-medium">{{ t('tools.timer_center.stats_col_kind') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('tools.timer_center.stats_col_duration') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('tools.timer_center.stats_col_time') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="(entry, index) in [...history].reverse().slice(0, 50)" :key="index">
              <td class="px-3 py-2">
                <span
                  class="rounded px-1.5 py-0.5 text-xs font-medium"
                  :class="entry.kind === 'pomodoro' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                >
                  {{ kindLabel(entry.kind) }}
                </span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatDuration(entry.seconds) }}</td>
              <td class="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {{ formatTime(entry.finishedAtEpochSecs) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
