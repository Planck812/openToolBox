<script setup lang="ts">
/**
 * 计时弹窗：按 kind 渲染（闹钟贪睡/关闭、倒计时确定、番茄确定/跳过、整点自动消失）。
 *
 * 独立精简入口（timer-main.ts）挂载，不加载主应用的 pinia/router/i18n，
 * 只用 @tauri-apps/api/core 的 invoke 与 @tauri-apps/api/window 关窗。
 *
 * 窗口 label = `timer-alert-{kind}-{id}`；解析后向后端 `timer_get_alert` 读载荷。
 * Esc / 点窗外（窗口失焦）/ 被动关闭：闹钟 = 贪睡（snooze 语义），其余 = 关闭。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AlarmClock,
  Clock,
  Timer,
  TimerReset,
} from 'lucide-vue-next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { timerAlertAction, timerGetAlert, timerGetPomodoro, type AlertPayload } from '@/lib/ipc/timer';

const { t } = useI18n();

/** 各弹窗类型对应图标。 */
const kindIconMap: Record<string, Component> = {
  alarm: AlarmClock,
  countdown: Timer,
  pomodoro: TimerReset,
  chime: Clock,
};
const kindIcon = computed(() => kindIconMap[kind.value] || AlarmClock);

/** 弹窗类型。 */
const kind = ref('');
/** 弹窗实例 id（闹钟为闹钟 id，其余为固定 id）。 */
const id = ref('');
/** 渲染载荷。 */
const payload = ref<AlertPayload | null>(null);
/** 读取载荷失败时的兜底提示。 */
const error = ref('');

/** 已主动处理（按钮/Esc），避免 onUnmounted 重复发动作。 */
let actionHandled = false;
/** 按钮按下标志：拦截按钮点击引发的短暂失焦，避免误判为「点窗外」。 */
let clickingButton = false;
/** 整点报时自动消失定时器。 */
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
/** 番茄弹窗：实时剩余秒数（每秒轮询后端）。 */
const pomodoroSecondsLeft = ref(-1);
/** 番茄弹窗：休息完成挂起（等待用户点「开始下一个番茄」）。 */
const pomodoroAwaitingNext = ref(false);
/** 番茄弹窗：当前阶段名（"work"|"short_break"|"long_break"，挂起时用于覆盖标题）。 */
const pomodoroPhase = ref('');
/** 番茄弹窗轮询定时器。 */
let pomodoroTimer: ReturnType<typeof setInterval> | null = null;

/** 阶段显示名（与后端 phase_label 一致）。 */
const PHASE_KEYS: Record<string, string> = {
  work: 'tools.timer_center.phase_work',
  short_break: 'tools.timer_center.phase_short_break',
  long_break: 'tools.timer_center.phase_long_break',
};

/** 番茄弹窗标题：挂起（休息完成）→「短休结束」；否则用后端 payload 的「正在XX」。 */
const pomodoroTitle = computed(() => {
  if (kind.value === 'pomodoro' && pomodoroAwaitingNext.value && pomodoroPhase.value) {
    const key = PHASE_KEYS[pomodoroPhase.value];
    const label = key ? t(key) : pomodoroPhase.value;
    return t('tools.timer_center.phase_ended', { label });
  }
  return payload.value?.title ?? '';
});

/** 格式化倒计时：如 "05:00"（分:秒，不足小时）/"01:05:00"（含小时）。 */
const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** 番茄弹窗：每秒拉取实时剩余秒数；休息走完挂起时切到「开始下一个番茄」按钮，不自动关窗。 */
const startPomodoroPolling = () => {
  const poll = async () => {
    try {
      const data = await timerGetPomodoro();
      pomodoroSecondsLeft.value = data.state.secondsLeft;
      pomodoroAwaitingNext.value = data.state.awaitingNext ?? false;
      pomodoroPhase.value = data.state.phase;
    } catch {
      // 拉取失败保持上次值，下个 tick 重试。
    }
  };
  void poll();
  pomodoroTimer = setInterval(() => void poll(), 1000);
};

/** Esc / 点窗外 / 被动关闭的默认动作：闹钟贪睡，其余关闭。 */
const defaultAction = (): string => (kind.value === 'alarm' ? 'snooze' : 'dismiss');

/** 发送弹窗动作并关窗。 */
const sendAction = async (action: string) => {
  actionHandled = true;
  try {
    await timerAlertAction({ kind: kind.value, action, id: id.value });
  } catch {
    // 忽略错误：后端可能已处理（如开关关闭时已关窗）。
  }
  try {
    await getCurrentWindow().close();
  } catch {
    // 窗口可能已被后端关闭，忽略。
  }
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void sendAction(defaultAction());
  }
};

const onBlur = () => {
  // 按钮点击可能短暂失焦：先消费按下标志，交给按钮的 click 处理，不视为「点窗外」。
  if (clickingButton) {
    clickingButton = false;
    return;
  }
  void sendAction(defaultAction());
};

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('blur', onBlur);
  // 解析窗口 label：timer-alert-{kind}-{id}
  const label = getCurrentWindow().label;
  const match = label.match(/^timer-alert-(.+?)-(.+)$/);
  if (match) {
    kind.value = match[1];
    id.value = match[2];
    try {
      payload.value = await timerGetAlert({
        kind: kind.value,
        id: id.value,
      });
    } catch (e) {
      error.value = typeof e === 'string' ? e : String(e);
    }
  } else {
    error.value = t('tools.timer_center.alert_unknown_kind');
  }
  // 整点报时：轻量小窗自动消失。
  if (payload.value?.autoDismiss) {
    dismissTimer = setTimeout(() => void sendAction('dismiss'), 5000);
  }
  // 番茄弹窗：实时倒计时 + 休息走完挂起时显示「开始下一个番茄」。
  if (kind.value === 'pomodoro') {
    startPomodoroPolling();
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('blur', onBlur);
  if (dismissTimer) clearTimeout(dismissTimer);
  if (pomodoroTimer) clearInterval(pomodoroTimer);
  // 被动关闭（Esc/点窗外/关窗/外部关闭）统一按默认动作处理；
  // 主动按钮/Esc 已置 actionHandled，避免重复调用。
  if (!actionHandled) {
    timerAlertAction({
      kind: kind.value,
      action: defaultAction(),
      id: id.value,
    }).catch(() => {});
  }
});
</script>

<template>
  <div
    class="timer-root"
    :class="kind === 'chime' ? 'timer-root-chime' : `timer-root-${kind || 'alarm'}`"
  >
    <component :is="kindIcon" class="timer-icon" :size="kind === 'chime' ? 40 : 64" :stroke-width="1.8" />
    <template v-if="payload">
      <div class="timer-title">{{ pomodoroTitle }}</div>
      <!-- 番茄弹窗：运行中显示实时倒计时；挂起（休息完成）显示「开始下一个番茄」按钮。 -->
      <div
        v-if="kind === 'pomodoro' && !pomodoroAwaitingNext && pomodoroSecondsLeft >= 0"
        class="timer-countdown"
      >
        {{ formatClock(pomodoroSecondsLeft) }}
      </div>
      <div v-else class="timer-message">{{ payload.message }}</div>
      <div v-if="!payload.autoDismiss" class="timer-actions">
        <button
          v-if="payload.showSnooze"
          class="timer-btn timer-btn-ghost"
          @mousedown="clickingButton = true"
          @mouseup="clickingButton = false"
          @click="sendAction('snooze')"
        >
          {{ t('tools.timer_center.alert_snooze') }}
        </button>
        <button
          v-if="payload.showSkip"
          class="timer-btn timer-btn-ghost"
          @mousedown="clickingButton = true"
          @mouseup="clickingButton = false"
          @click="sendAction('skip')"
        >
          {{ t('tools.timer_center.alert_skip') }}
        </button>
        <!-- 番茄休息完成挂起：主按钮变为「开始下一个番茄」，推进到工作阶段。 -->
        <button
          v-if="payload.showClose"
          class="timer-btn timer-btn-primary"
          @mousedown="clickingButton = true"
          @mouseup="clickingButton = false"
          @click="sendAction(kind === 'pomodoro' && pomodoroAwaitingNext ? 'start_next' : kind === 'alarm' ? 'close' : 'dismiss')"
        >
          {{
            kind === 'pomodoro' && pomodoroAwaitingNext
              ? t('tools.timer_center.alert_start_next_pomodoro')
              : kind === 'alarm'
                ? t('tools.timer_center.alert_close')
                : t('tools.timer_center.alert_confirm')
          }}
        </button>
      </div>
    </template>
    <div v-else-if="error" class="timer-error">{{ error }}</div>
    <div v-else class="timer-loading">{{ t('tools.timer_center.loading') }}</div>
  </div>
</template>

<style>
/* 非 scoped：强制透明弹窗窗口背景（照 ReminderWindow 的 reminder-window 模式）。 */
html.timer-window,
html.timer-window body {
  background: transparent !important;
  background-image: none !important;
  background-color: transparent !important;
}
html.timer-window::before {
  display: none !important;
}
</style>

<style scoped>
.timer-root {
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 32px;
  text-align: center;
  color: #ffffff;
  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  user-select: none;
}

.timer-root-alarm {
  background: #dc2626;
  animation: timer-pulse 1s ease-in-out infinite;
}
.timer-root-countdown {
  background: #2563eb;
}
.timer-root-pomodoro {
  background: #16a34a;
}
.timer-root-chime {
  background: rgba(30, 41, 59, 0.92);
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  border-radius: 18px;
}
@keyframes timer-pulse {
  0%,
  100% {
    background-color: #dc2626;
  }
  50% {
    background-color: #b91c1c;
  }
}

.timer-icon {
  color: #ffffff;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
}

.timer-title {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  max-width: 100%;
  overflow-wrap: break-word;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.timer-message {
  font-size: 18px;
  font-weight: 700;
  opacity: 0.92;
  max-width: 100%;
  overflow-wrap: break-word;
  line-height: 1.4;
}

/* 番茄弹窗：大号实时倒计时（当前阶段剩余），醒目易读。 */
.timer-countdown {
  font-size: 56px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  line-height: 1.1;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.timer-actions {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.timer-btn {
  min-width: 110px;
  padding: 11px 24px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s, box-shadow 0.15s, opacity 0.15s;
}
.timer-btn:active {
  transform: scale(0.95);
}

.timer-btn-primary {
  background: #ffffff;
  color: #111827;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.timer-btn-primary:hover {
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.38);
  opacity: 0.94;
}

.timer-btn-ghost {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  border: 1.5px solid rgba(255, 255, 255, 0.75);
}
.timer-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.24);
}

.timer-error,
.timer-loading {
  font-size: 15px;
  font-weight: 600;
  opacity: 0.9;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}
</style>
