<script setup lang="ts">
/**
 * 计时中心：顶部 tab 切换（闹钟 / 倒计时 / 秒表 / 番茄钟 / 统计）。
 *
 * 每个 tab 为独立子组件，各自调用对应 invoke 命令；秒表为纯前端实现。
 * 弹窗与后台调度全由 Rust `src-tauri/src/timer/` 模块管理。
 */
import { ref } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlarmClock, BarChart3, StopCircle, Timer, TimerReset } from 'lucide-vue-next';
import AlarmTab from './AlarmTab.vue';
import CountdownTab from './CountdownTab.vue';
import StopwatchTab from './StopwatchTab.vue';
import PomodoroTab from './PomodoroTab.vue';
import StatsTab from './StatsTab.vue';

const { t } = useI18n();

type TabKey = 'alarm' | 'countdown' | 'stopwatch' | 'pomodoro' | 'stats';

const tabs: { key: TabKey; labelKey: string; icon: Component }[] = [
  { key: 'alarm', labelKey: 'tools.timer_center.tab_alarm', icon: AlarmClock },
  { key: 'countdown', labelKey: 'tools.timer_center.tab_countdown', icon: Timer },
  { key: 'stopwatch', labelKey: 'tools.timer_center.tab_stopwatch', icon: StopCircle },
  { key: 'pomodoro', labelKey: 'tools.timer_center.tab_pomodoro', icon: TimerReset },
  { key: 'stats', labelKey: 'tools.timer_center.tab_stats', icon: BarChart3 },
];

const activeTab = ref<TabKey>('alarm');
</script>

<template>
  <div class="h-full overflow-auto bg-background text-foreground">
    <div class="mx-auto max-w-4xl p-6">
      <div class="mb-5 flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Timer class="h-6 w-6" />
        </div>
        <div>
          <h2 class="text-lg font-semibold">{{ t('tools.timer_center.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('tools.timer_center.subtitle') }}</p>
        </div>
      </div>

      <!-- Tab 切换 -->
      <div class="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-w-24"
          :class="activeTab === tab.key
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted'"
          @click="activeTab = tab.key"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <div class="rounded-xl border border-border bg-card p-5 shadow-sm">
        <AlarmTab v-if="activeTab === 'alarm'" />
        <CountdownTab v-else-if="activeTab === 'countdown'" />
        <StopwatchTab v-else-if="activeTab === 'stopwatch'" />
        <PomodoroTab v-else-if="activeTab === 'pomodoro'" />
        <StatsTab v-else />
      </div>
    </div>
  </div>
</template>
