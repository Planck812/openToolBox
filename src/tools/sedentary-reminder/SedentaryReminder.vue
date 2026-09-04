<script setup lang="ts">
/**
 * 久坐提醒工具页：查看当前状态（已坐时长/剩余时间）、总开关、调整配置。
 *
 * 状态与计时全在后端，本页仅展示与发命令。每 1s 轮询 sedentary_get_state；
 * keep-alive 缓存下 timer 在 onDeactivated / onBeforeUnmount 清理（照 MermaidPreview 模式）。
 */
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { AlarmClock, Play, Plus, Power, RotateCcw, Save, Video, X } from 'lucide-vue-next';
import {
  sedentaryGetConfig,
  sedentaryGetState,
  sedentaryPreview,
  sedentaryResetUserVideo,
  sedentarySetConfig,
  sedentarySetUserVideo,
  sedentaryToggle,
} from '@/lib/ipc/sedentary';

/** 用户上传视频文件名（与后端 SEDENTARY_USER_VIDEO_FILE_NAME 一致，用于识别来源）。 */
const SEDENTARY_USER_VIDEO_FILE_NAME = 'user-video.mp4';

const { t } = useI18n();
const store = useAppStore();

/** 当前平台是否支持空闲检测（非 Windows 不支持）。 */
const supported = ref(true);
const enabled = ref(false);
const sittingSeconds = ref(0);
const remindSeconds = ref(0);

/** 配置草稿（保存前可修改）。 */
const remindMinutes = ref(60);
const idleResetMinutes = ref(5);
const message = ref('');
/** 视频播放开关草稿（保存时一并提交）。 */
const videoEnabled = ref(true);
/** 当前生效的提醒视频路径（用于显示来源；空 = 无视频）。 */
const videoPath = ref('');
/** 屏蔽时段草稿（每行「起始-结束」，HH:MM；空串 = 未填写）。 */
const quietPeriods = ref<{ start: string; end: string }[]>([]);
/** 当前是否处于屏蔽时段（后端状态，1s 轮询刷新）。 */
const quietActive = ref(false);
/** 距屏蔽结束剩余秒数（非屏蔽中为 0）。 */
const quietRemainingSeconds = ref(0);

const loading = ref(true);
const errorMessage = ref('');
const saving = ref(false);
/** 预览弹窗调用中（复用 saving 的禁用模式）。 */
const previewing = ref(false);
/** 选择/上传自定义视频进行中。 */
const choosingVideo = ref(false);
/** 恢复默认视频进行中。 */
const restoringVideo = ref(false);
/** 组件当前是否处于激活状态（keep-alive 缓存下可被停用）。 */
const isActive = ref(true);
/** 保存成功后按钮短暂显示「已保存 ✓」成功态（约 2 秒后恢复）。 */
const savedFlash = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;
/** savedFlash 恢复定时器（组件卸载时清理）。 */
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;

/** 剩余秒数（不小于 0）。 */
const remainingSeconds = computed(() => Math.max(0, remindSeconds.value - sittingSeconds.value));

/** 格式化时长：如「45 分钟」「45 分钟 12 秒」「36 秒」。 */
const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return t('common.duration_seconds', { n: s });
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  return rest > 0
    ? t('common.duration_minutes_seconds', { n: minutes, m: rest })
    : t('common.duration_minutes', { n: minutes });
};

/** 时间输入框样式（屏蔽时段行内复用；重叠行额外加红色边框提示）。 */
const timeInputClass =
  'w-32 rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20';

/** 解析时间为当日分钟数（type="time" 的值可能是 HH:MM 或带秒的 HH:MM:SS，只取前两段计算）。 */
const timeToMinutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

/**
 * 归一化时间为 "HH:MM"（取前两段）。
 * WebView2 的 type="time" 允许手动输入带秒的 "HH:MM:SS"，value 即返回三段；
 * 提交给后端的一律用 HH:MM，后端对秒的容错仅作兜底（防旧 store 数据/直接改配置）。
 */
const normalizeTime = (t: string) => t.split(':').slice(0, 2).join(':');

/**
 * 时间输入变更/失焦时立即把 value 归一化为 HH:MM 回写 v-model。
 * WebView2 的 type="time" 手动输入仍可得出带秒的 "HH:MM:SS"，这里直接取
 * 原生 input 的当前值归一化，避免输入过程中显示秒；空串保持为空（中间态，
 * 保存时校验拦截）。
 */
const onTimeChange = (e: Event, period: { start: string; end: string }, key: 'start' | 'end') => {
  period[key] = normalizeTime((e.target as HTMLInputElement).value);
};

/** 时段展开为分钟区间集合：同天 [s,e)；跨天 [s,1440) ∪ [0,e)。空串行返回 null。 */
const toQuietIntervals = (p: { start: string; end: string }): [number, number][] | null => {
  if (!p.start || !p.end) return null;
  const start = timeToMinutes(p.start);
  const end = timeToMinutes(p.end);
  return start < end ? [[start, end]] : [[start, 1440], [0, end]];
};

/** 两时段是否重叠（任一展开区间相交即重叠；与后端 validate_quiet_periods 同规则）。 */
const periodsOverlap = (
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean => {
  const ia = toQuietIntervals(a);
  const ib = toQuietIntervals(b);
  if (!ia || !ib) return false;
  for (const [as, ae] of ia) {
    for (const [bs, be] of ib) {
      if (as < be && bs < ae) return true;
    }
  }
  return false;
};

/** 时段列表是否存在两两重叠（与后端 validate_quiet_periods 同规则）。 */
const hasOverlap = (periods: { start: string; end: string }[]): boolean => {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (periodsOverlap(periods[i], periods[j])) return true;
    }
  }
  return false;
};

/** 与其它时段重叠的行索引（逐行红框 + 提示文案）。 */
const overlappingRows = computed(() => {
  const rows = new Set<number>();
  for (let i = 0; i < quietPeriods.value.length; i++) {
    for (let j = i + 1; j < quietPeriods.value.length; j++) {
      if (periodsOverlap(quietPeriods.value[i], quietPeriods.value[j])) {
        rows.add(i);
        rows.add(j);
      }
    }
  }
  return [...rows];
});

/** 添加一条空白屏蔽时段。 */
const addQuietPeriod = () => {
  quietPeriods.value.push({ start: '', end: '' });
};

/** 删除指定行屏蔽时段。 */
const removeQuietPeriod = (index: number) => {
  quietPeriods.value.splice(index, 1);
};

const loadConfig = async (showLoading = true) => {
  if (showLoading) loading.value = true;
  errorMessage.value = '';
  try {
    const config = await sedentaryGetConfig();
    supported.value = config.supported;
    enabled.value = config.enabled;
    remindMinutes.value = config.remindMinutes;
    idleResetMinutes.value = config.idleResetMinutes;
    message.value = config.message;
    videoEnabled.value = config.videoEnabled;
    videoPath.value = config.videoPath;
    quietPeriods.value = config.quietPeriods ?? [];
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  } finally {
    if (showLoading) loading.value = false;
  }
};

const loadState = async () => {
  try {
    const state = await sedentaryGetState();
    enabled.value = state.enabled;
    sittingSeconds.value = state.sittingSeconds;
    remindSeconds.value = state.remindSeconds;
    quietActive.value = state.quietActive;
    quietRemainingSeconds.value = state.quietRemainingSeconds;
  } catch {
    // 轮询失败忽略，下次再试。
  }
};

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = setInterval(() => void loadState(), 1000);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/** 总开关。 */
const toggleEnabled = async () => {
  if (!supported.value) return;
  const next = !enabled.value;
  try {
    await sedentaryToggle(next);
    enabled.value = next;
    store.showToast(
      next
        ? t('tools.sedentary_reminder.toggle_enabled')
        : t('tools.sedentary_reminder.toggle_disabled'),
      { type: 'success' },
    );
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    store.showToast(t('tools.sedentary_reminder.toggle_failed'), { type: 'error' });
  }
};

/** 预览提醒弹窗：调用后端直接弹出与真实提醒一致的窗口（不消耗冷却期）。 */
const previewReminder = async () => {
  if (!supported.value || previewing.value) return;
  previewing.value = true;
  try {
    await sedentaryPreview();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    store.showToast(t('tools.sedentary_reminder.preview_failed'), { type: 'error' });
  } finally {
    previewing.value = false;
  }
};

/** 当前生效视频来源描述（自定义 / 默认视频 / 无视频）。 */
const videoStatusLabel = computed(() => {
  if (!videoPath.value) return t('tools.sedentary_reminder.video_status_none');
  if (videoPath.value.endsWith(SEDENTARY_USER_VIDEO_FILE_NAME)) {
    return t('tools.sedentary_reminder.video_status_custom');
  }
  return t('tools.sedentary_reminder.video_status_default');
});

/** 选择并上传自定义提醒视频：文件框（过滤 mp4/webm/mov）→ 后端复制为 user-video.mp4。 */
const chooseVideo = async () => {
  if (!supported.value || choosingVideo.value) return;
  choosingVideo.value = true;
  try {
    const path = await open({
      multiple: false,
      filters: [{ name: t('tools.sedentary_reminder.choose_video_filter'), extensions: ['mp4', 'webm', 'mov'] }],
    });
    if (!path) return; // 用户取消选择。
    await sedentarySetUserVideo(path);
    await loadConfig(false);
    store.showToast(t('tools.sedentary_reminder.video_uploaded'), { type: 'success' });
  } catch (e) {
    const msg = typeof e === 'string' ? e : String(e);
    errorMessage.value = msg;
    // 后端超限错误信息含大小上限标记，映射为专用提示。
    store.showToast(
      msg.includes('20MB')
        ? t('tools.sedentary_reminder.video_too_large')
        : t('tools.sedentary_reminder.choose_video_failed'),
      { type: 'error' },
    );
  } finally {
    choosingVideo.value = false;
  }
};

/** 恢复默认提醒视频：删除自定义视频，回退固定源（源缺失则无视频模式）。 */
const restoreDefaultVideo = async () => {
  if (!supported.value || restoringVideo.value) return;
  restoringVideo.value = true;
  try {
    await sedentaryResetUserVideo();
    await loadConfig(false);
    store.showToast(t('tools.sedentary_reminder.video_restored'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    store.showToast(t('tools.sedentary_reminder.restore_default_failed'), { type: 'error' });
  } finally {
    restoringVideo.value = false;
  }
};

/** 保存配置（间隔 30-120、闲置阈值 ≥1、屏蔽时段格式与重叠校验通过后提交）。 */
const saveConfig = async () => {
  if (!supported.value || saving.value) return;
  const remind = Number(remindMinutes.value);
  const idle = Number(idleResetMinutes.value);
  if (!Number.isFinite(remind) || !Number.isFinite(idle)) {
    store.showToast(t('tools.sedentary_reminder.invalid_number'), { type: 'error' });
    return;
  }
  // 屏蔽时段校验（与后端同规则）：半填行无效、start != end、两两不重叠。
  const filledPeriods = quietPeriods.value.filter((p) => p.start || p.end);
  if (filledPeriods.some((p) => !p.start || !p.end)) {
    store.showToast(t('tools.sedentary_reminder.quiet_period_invalid'), { type: 'error' });
    return;
  }
  if (filledPeriods.some((p) => p.start === p.end)) {
    store.showToast(t('tools.sedentary_reminder.quiet_period_invalid'), { type: 'error' });
    return;
  }
  if (hasOverlap(filledPeriods)) {
    store.showToast(t('tools.sedentary_reminder.quiet_period_overlap'), { type: 'error' });
    return;
  }
  saving.value = true;
  try {
    await sedentarySetConfig({
      remindMinutes: Math.min(120, Math.max(1, Math.round(remind))),
      idleResetMinutes: Math.max(1, Math.round(idle)),
      message: message.value,
      videoEnabled: videoEnabled.value,
      // 提交前把每个时段归一化为 HH:MM（校验仍用原值，分钟精度一致；后端容错仅作兜底）。
      quietPeriods: filledPeriods.map((p) => ({
        start: normalizeTime(p.start),
        end: normalizeTime(p.end),
      })),
    });
    // 保存成功后重新回显后端实际保存的值（后端可能 clamp 或忽略空文案）。
    await loadConfig(false);
    // 立即刷新状态卡（刚保存的屏蔽时段可能已生效「屏蔽中」，不必等 1s 轮询）。
    await loadState();
    store.showToast(t('tools.sedentary_reminder.saved'), { type: 'success', durationMs: 4000 });
    // 按钮短暂显示「已保存 ✓」成功态（约 2 秒后恢复）。
    savedFlash.value = true;
    if (savedFlashTimer) clearTimeout(savedFlashTimer);
    savedFlashTimer = setTimeout(() => {
      savedFlash.value = false;
      savedFlashTimer = null;
    }, 2000);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    store.showToast(t('tools.sedentary_reminder.save_failed'), { type: 'error' });
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  await loadConfig();
  // 加载配置（IPC 往返）期间用户可能已切走（keep-alive 停用）：此时不再启动轮询，避免泄漏。
  if (!isActive.value) return;
  if (supported.value) {
    await loadState();
    startPolling();
  }
});

onActivated(() => {
  isActive.value = true;
  if (supported.value) {
    void loadState();
    startPolling();
  }
});

onDeactivated(() => {
  isActive.value = false;
  stopPolling();
});

onBeforeUnmount(() => {
  isActive.value = false;
  stopPolling();
  // 清理保存成功闪烁恢复定时器，避免卸载后仍修改状态。
  if (savedFlashTimer) {
    clearTimeout(savedFlashTimer);
    savedFlashTimer = null;
  }
});
</script>

<template>
  <div class="h-full overflow-auto bg-background text-foreground">
    <div class="mx-auto max-w-3xl p-6">
      <div class="mb-6 flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <AlarmClock class="h-6 w-6" />
        </div>
        <div>
          <h2 class="text-lg font-semibold">{{ t('tools.sedentary_reminder.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('tools.sedentary_reminder.subtitle') }}</p>
        </div>
      </div>

      <div v-if="errorMessage" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        {{ errorMessage }}
      </div>

      <!-- 平台不支持 -->
      <div
        v-else-if="!supported"
        class="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-10 text-center"
      >
        <p class="text-sm font-medium text-destructive">
          {{ t('tools.sedentary_reminder.unsupported') }}
        </p>
      </div>

      <template v-else>
        <!-- 状态卡片 -->
        <div v-if="loading" class="py-8 text-center text-sm text-muted-foreground">
          {{ t('tools.sedentary_reminder.loading') }}
        </div>
        <template v-else>
          <div class="mb-6 grid gap-4 sm:grid-cols-3">
            <div class="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p class="text-xs text-muted-foreground">
                {{ t('tools.sedentary_reminder.sitting_label') }}
              </p>
              <p class="mt-1 text-2xl font-bold tabular-nums">
                {{ formatDuration(sittingSeconds) }}
              </p>
            </div>
            <div class="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p class="text-xs text-muted-foreground">
                {{ t('tools.sedentary_reminder.remaining_label') }}
              </p>
              <p class="mt-1 text-2xl font-bold tabular-nums">
                {{ formatDuration(remainingSeconds) }}
              </p>
            </div>
            <div class="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p class="text-xs text-muted-foreground">
                {{ t('tools.sedentary_reminder.status_label') }}
              </p>
              <p v-if="quietActive" class="mt-1 text-2xl font-bold">
                {{ t('tools.sedentary_reminder.status_quiet_remaining', {
                  duration: formatDuration(quietRemainingSeconds),
                }) }}
              </p>
              <p v-else class="mt-1 text-2xl font-bold">
                {{ enabled
                  ? t('tools.sedentary_reminder.status_enabled')
                  : t('tools.sedentary_reminder.status_disabled') }}
              </p>
            </div>
          </div>

          <!-- 预览提醒弹窗 -->
          <div class="mb-6 flex justify-center">
            <button
              class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="previewing"
              @click="previewReminder"
            >
              <Play class="h-4 w-4" />
              {{ t('tools.sedentary_reminder.preview') }}
            </button>
          </div>

          <!-- 总开关 -->
          <div class="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-sm font-medium">
                  {{ t('tools.sedentary_reminder.enabled_label') }}
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ enabled
                    ? t('tools.sedentary_reminder.enabled_hint')
                    : t('tools.sedentary_reminder.disabled_hint') }}
                </p>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                :class="enabled
                  ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90'"
                @click="toggleEnabled"
              >
                <Power class="h-4 w-4" />
                {{ enabled
                  ? t('tools.sedentary_reminder.disable')
                  : t('tools.sedentary_reminder.enable') }}
              </button>
            </div>
          </div>

          <!-- 配置 -->
          <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 class="mb-4 text-sm font-semibold">
              {{ t('tools.sedentary_reminder.config_title') }}
            </h3>
            <div class="space-y-4">
              <label class="block">
                <span class="mb-1 block text-sm text-muted-foreground">
                  {{ t('tools.sedentary_reminder.interval_label') }}
                </span>
                <div class="flex items-center gap-2">
                  <input
                    v-model.number="remindMinutes"
                    type="number"
                    min="1"
                    max="120"
                    class="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span class="text-sm text-muted-foreground">
                    {{ t('tools.sedentary_reminder.minutes_unit') }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ t('tools.sedentary_reminder.interval_hint') }}
                </p>
              </label>

              <label class="block">
                <span class="mb-1 block text-sm text-muted-foreground">
                  {{ t('tools.sedentary_reminder.idle_reset_label') }}
                </span>
                <div class="flex items-center gap-2">
                  <input
                    v-model.number="idleResetMinutes"
                    type="number"
                    min="1"
                    class="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span class="text-sm text-muted-foreground">
                    {{ t('tools.sedentary_reminder.minutes_unit') }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ t('tools.sedentary_reminder.idle_reset_hint') }}
                </p>
              </label>

              <label class="block">
                <span class="mb-1 block text-sm text-muted-foreground">
                  {{ t('tools.sedentary_reminder.message_label') }}
                </span>
                <textarea
                  v-model="message"
                  rows="4"
                  class="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  :placeholder="t('tools.sedentary_reminder.message_placeholder')"
                ></textarea>
              </label>

              <!-- 屏蔽时段 -->
              <div class="border-t border-border pt-4">
                <p class="text-sm font-medium">
                  {{ t('tools.sedentary_reminder.quiet_periods_label') }}
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ t('tools.sedentary_reminder.quiet_periods_hint') }}
                </p>
                <p v-if="quietActive" class="mt-1 text-xs text-destructive">
                  {{ t('tools.sedentary_reminder.quiet_active_status', {
                    label: t('tools.sedentary_reminder.quiet_active_label'),
                    hint: t('tools.sedentary_reminder.quiet_active_hint'),
                  }) }}
                </p>
                <div class="mt-3 space-y-3">
                  <div v-for="(period, index) in quietPeriods" :key="index">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-xs text-muted-foreground">
                        {{ t('tools.sedentary_reminder.quiet_period_start') }}
                      </span>
                      <input
                        v-model="period.start"
                        type="time"
                        step="60"
                        :class="[
                          timeInputClass,
                          overlappingRows.includes(index) ? 'border-destructive' : 'border-border',
                        ]"
                        @change="onTimeChange($event, period, 'start')"
                      />
                      <span class="text-xs text-muted-foreground">
                        {{ t('tools.sedentary_reminder.quiet_period_end') }}
                      </span>
                      <input
                        v-model="period.end"
                        type="time"
                        step="60"
                        :class="[
                          timeInputClass,
                          overlappingRows.includes(index) ? 'border-destructive' : 'border-border',
                        ]"
                        @change="onTimeChange($event, period, 'end')"
                      />
                      <button
                        class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        @click="removeQuietPeriod(index)"
                      >
                        <X class="h-3.5 w-3.5" />
                        {{ t('tools.sedentary_reminder.remove_quiet_period') }}
                      </button>
                    </div>
                    <p v-if="overlappingRows.includes(index)" class="mt-1 text-xs text-destructive">
                      {{ t('tools.sedentary_reminder.quiet_period_overlap') }}
                    </p>
                  </div>
                </div>
                <button
                  class="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                  @click="addQuietPeriod"
                >
                  <Plus class="h-4 w-4" />
                  {{ t('tools.sedentary_reminder.add_quiet_period') }}
                </button>
              </div>

              <!-- 视频设置 -->
              <div class="border-t border-border pt-4">
                <div class="space-y-3">
                  <label class="flex cursor-pointer select-none items-center gap-2">
                    <input
                      v-model="videoEnabled"
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span class="text-sm font-medium">
                      {{ t('tools.sedentary_reminder.video_enabled_label') }}
                    </span>
                  </label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('tools.sedentary_reminder.video_enabled_hint') }}
                  </p>
                  <p class="text-xs text-muted-foreground">{{ videoStatusLabel }}</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      class="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="choosingVideo"
                      @click="chooseVideo"
                    >
                      <Video class="h-4 w-4" />
                      {{ t('tools.sedentary_reminder.choose_video') }}
                    </button>
                    <button
                      class="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="restoringVideo"
                      @click="restoreDefaultVideo"
                    >
                      <RotateCcw class="h-4 w-4" />
                      {{ t('tools.sedentary_reminder.restore_default') }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex justify-end">
                <button
                  class="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  :class="savedFlash
                    ? 'bg-emerald-600 text-white'
                    : 'bg-primary text-primary-foreground hover:opacity-90'"
                  :disabled="saving"
                  @click="saveConfig"
                >
                  <Save class="h-4 w-4" />
                  {{ saving
                    ? t('tools.sedentary_reminder.saving')
                    : savedFlash
                      ? `${t('tools.sedentary_reminder.saved')} ✓`
                      : t('tools.sedentary_reminder.save') }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
