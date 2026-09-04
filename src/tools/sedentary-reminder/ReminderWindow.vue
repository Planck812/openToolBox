<script setup lang="ts">
/**
 * 久坐提醒弹窗：强警示大窗（整体大红色 + 脉冲动画）。
 *
 * 独立精简入口（reminder-main.ts）挂载，不加载主应用的 pinia/router/i18n，
 * 只用 @tauri-apps/api/core 的 invoke 与 @tauri-apps/api/window 关窗。
 *
 * 「已起身」= 重置计时并关窗；「稍后」= 关窗，5 分钟后再次提醒（继续累计）；
 * Esc / 点窗外（窗口失焦）/ 被动关闭（关窗）= 同「稍后」（snooze 语义，不重置）。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle } from 'lucide-vue-next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { renderMessage } from './markdown';
import {
  sedentaryGetConfig,
  sedentaryGetState,
  sedentaryRemindAction,
} from '@/lib/ipc/sedentary';

const { t } = useI18n();

/** 默认文案（读取配置失败时兜底，与后端默认值一致）。 */
const DEFAULT_MESSAGE = t('tools.sedentary_reminder.default_message');

/** 已坐时长（秒）。 */
const sittingSeconds = ref(0);
/** 提示文案。 */
const message = ref(DEFAULT_MESSAGE);
/** 弹窗阶段：'video' = 先播放提醒视频；'reminder' = 红色脉冲提醒界面。 */
const phase = ref<'video' | 'reminder'>('reminder');
/** 提醒视频 asset URL（convertFileSrc 转换；无视频时为空串不进入 video 阶段）。 */
const videoUrl = ref('');
/** 已主动处理（按钮/Esc），避免 onUnmounted 重复发 snooze。 */
let actionHandled = false;
/** 按钮按下标志：拦截按钮点击引发的短暂失焦，避免误判为「点窗外」。 */
let clickingButton = false;
/** 视频点击标志：拦截视频点击引发的短暂失焦（照 clickingButton 模式）。 */
let clickingVideo = false;

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

/** 发送弹窗动作并关窗。 */
const sendAction = async (action: 'got_up' | 'snooze') => {
  actionHandled = true;
  try {
    await sedentaryRemindAction(action);
  } catch {
    // 忽略错误：后端可能已处理（如开关关闭时已关窗）。
  }
  try {
    await getCurrentWindow().close();
  } catch {
    // 窗口可能已被后端关闭，忽略。
  }
};

/** 跳过视频阶段，直接进入红色提醒界面（不重置计时）。 */
const skipVideo = () => {
  if (phase.value === 'video') {
    phase.value = 'reminder';
  }
};

/** Esc 按阶段分流：video → 跳红色界面；reminder → 稍后（关窗，5 分钟后再提醒，不重置计时）。 */
const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (phase.value === 'video') {
    skipVideo();
    return;
  }
  void sendAction('snooze');
};

/** 点窗外（窗口失焦）＝ 稍后（关窗，5 分钟后再提醒，不重置计时）。 */
const onBlur = () => {
  // 按钮/视频点击可能短暂失焦：先消费按下标志，交给 click 处理，不视为「点窗外」。
  if (clickingButton || clickingVideo) {
    clickingButton = false;
    clickingVideo = false;
    return;
  }
  void sendAction('snooze');
};

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('blur', onBlur);
  try {
    const config = await sedentaryGetConfig();
    if (config.message.trim()) {
      message.value = config.message.trim();
    }
    // 有视频（非空路径）且开关开启：转换 asset URL 并进入视频阶段；
    // 无视频或开关关闭：保持 reminder 阶段（直接红色界面，不播放视频）。
    if (config.videoPath && config.videoEnabled) {
      videoUrl.value = convertFileSrc(config.videoPath);
      phase.value = 'video';
    }
  } catch {
    // 读取失败用默认文案。
  }
  try {
    const state = await sedentaryGetState();
    sittingSeconds.value = state.sittingSeconds;
  } catch {
    // 读取失败保持 0。
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('blur', onBlur);
  // 被动关闭（Esc/点窗外/关窗/外部关闭）统一视为 snooze（关窗，5 分钟后再次提醒）；
  // 主动按钮/Esc 已置 actionHandled，避免重复调用。
  if (!actionHandled) {
    sedentaryRemindAction('snooze').catch(() => {});
  }
});
</script>

<template>
  <div class="reminder-root">
    <!-- 阶段 1：全屏静音播放提醒视频（无按钮）；ended / error / Esc / 点击均跳阶段 2。 -->
    <video
      v-if="phase === 'video'"
      class="reminder-video"
      :src="videoUrl"
      muted
      autoplay
      playsinline
      @ended="skipVideo"
      @error="skipVideo"
      @click="skipVideo"
      @mousedown="clickingVideo = true"
      @mouseup="clickingVideo = false"
    ></video>
    <!-- 阶段 2：红色脉冲提醒界面（无视频模式直接进入此阶段）。 -->
    <template v-else>
      <AlertTriangle class="reminder-icon" :size="72" :stroke-width="1.8" />
      <div class="reminder-title">{{ t('tools.sedentary_reminder.title') }}</div>
      <div class="reminder-duration">
        {{ t('tools.sedentary_reminder.reminder_sitting', { duration: formatDuration(sittingSeconds) }) }}
      </div>
      <div class="reminder-message" v-html="renderMessage(message)"></div>
      <div class="reminder-actions">
        <button
          class="reminder-btn reminder-btn-primary"
          @mousedown="clickingButton = true"
          @mouseup="clickingButton = false"
          @click="sendAction('got_up')"
        >
          {{ t('tools.sedentary_reminder.got_up') }}
        </button>
        <button
          class="reminder-btn reminder-btn-ghost"
          @mousedown="clickingButton = true"
          @mouseup="clickingButton = false"
          @click="sendAction('snooze')"
        >
          {{ t('tools.sedentary_reminder.snooze') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style>
/* 非 scoped：强制透明弹窗窗口背景（照 OverlayView 的 overlay-window 模式）。
   全局 style.css 的 html/body 背景色会盖住透明窗口形成白底，这里 !important 覆盖。 */
html.reminder-window,
html.reminder-window body {
  background: transparent !important;
  background-image: none !important;
  background-color: transparent !important;
}
html.reminder-window::before {
  display: none !important;
}
</style>

<style scoped>
.reminder-root {
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 28px 36px;
  text-align: center;
  color: #ffffff;
  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  user-select: none;
  /* 整体大红色 + 脉冲动画：亮红 ↔ 深红缓慢脉动（约 1s 周期，非明灭闪烁）。 */
  background-color: #dc2626;
  animation: reminder-pulse 1s ease-in-out infinite;
}

/* 提醒视频：全屏铺满窗口（cover 裁切无黑边），黑底兜底。 */
.reminder-video {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
  cursor: pointer;
}
@keyframes reminder-pulse {
  0%,
  100% {
    background-color: #dc2626;
  }
  50% {
    background-color: #b91c1c;
  }
}

.reminder-icon {
  /* 大号白色感叹图标，配合整体警示氛围；轻微脉动缩放强化「警告感」。 */
  color: #ffffff;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
  animation: reminder-icon-pulse 1s ease-in-out infinite;
}
@keyframes reminder-icon-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

.reminder-title {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 4px;
  line-height: 1.2;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.reminder-duration {
  font-size: 18px;
  font-weight: 700;
  opacity: 0.92;
}

.reminder-message {
  font-size: 22px;
  font-weight: 800;
  max-width: 100%;
  overflow-wrap: break-word;
  line-height: 1.4;
}

/* v-html 渲染的段落会带 UA 默认 1em 上下边距，纯文本输入（默认文案）会产生
   视觉偏移（AC-8 纯文本行为与改动前一致），这里归零段落边距。 */
.reminder-message :deep(p) {
  margin: 0;
}

.reminder-actions {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.reminder-btn {
  min-width: 120px;
  padding: 12px 28px;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s, box-shadow 0.15s, opacity 0.15s;
}
.reminder-btn:active {
  transform: scale(0.95);
}

/* 「已起身」：白底红字，醒目主按钮。 */
.reminder-btn-primary {
  background: #ffffff;
  color: #dc2626;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.reminder-btn-primary:hover {
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.38);
  opacity: 0.94;
}

/* 「稍后」：半透明白边白字，次级。 */
.reminder-btn-ghost {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  border: 1.5px solid rgba(255, 255, 255, 0.75);
}
.reminder-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.24);
}
</style>
