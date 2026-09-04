<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { computed, defineAsyncComponent, shallowRef, watch, type Component } from 'vue';
import { getToolById } from '@/tools/registry';
import { ArrowLeft } from 'lucide-vue-next';
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { logContext } from '@/lib/logger';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const { inputContent } = storeToRefs(store);
const { t } = useI18n();

const toolId = computed(() => route.params.id as string);
const tool = computed(() => getToolById(toolId.value));
const ToolComponent = shallowRef<Component | null>(null);
const loadError = shallowRef<string | null>(null);

/**
 * 按 toolId 创建异步组件（不在 computed 中反复 defineAsyncComponent）。
 */
const resolveToolComponent = async (id: string) => {
  loadError.value = null;
  ToolComponent.value = null;

  const current = getToolById(id);
  if (!current) {
    logContext('warn', 'ToolView', 'resolveToolComponent', `Tool not found: ${id}`);
    return;
  }

  logContext('info', 'ToolView', 'resolveToolComponent', `Loading tool: ${id} (${current.metadata.name})`);
  store.addRecentTool(id);

  const componentLoadStart = performance.now();
  ToolComponent.value = defineAsyncComponent({
    loader: current.component as () => Promise<Component>,
    onError(error) {
      const duration = performance.now() - componentLoadStart;
      loadError.value = error instanceof Error ? error.message : String(error);
      logContext('error', 'ToolView', 'resolveToolComponent', `Component load failed: ${id}`, {
        error: loadError.value,
        duration: duration.toFixed(2),
      });
    },
    delay: 80,
    timeout: 15000,
  });

  // 记录异步组件开始加载
  logContext('debug', 'ToolView', 'resolveToolComponent', `Component loading started: ${id}`);
};

watch(toolId, (id) => resolveToolComponent(id), { immediate: true });

const goBack = () => {
  router.push('/');
};
</script>

<template>
  <div data-testid="tool-view" class="tool-view flex h-full min-h-0 flex-col">
    <div class="tool-header p-4 flex items-center gap-3 shrink-0">
      <button
        data-testid="tool-back-button"
        type="button"
        class="tool-back-btn p-2 rounded-full transition-colors"
        @click="goBack"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <h1 class="text-lg font-bold tool-title">{{ tool ? t(tool.metadata.name) : 'Tool' }}</h1>
    </div>

    <div class="tool-body min-h-0 flex-1 overflow-auto">
      <div v-if="loadError" class="p-8 text-center text-sm text-rose-500">
        {{ t('tools.tool_load_failed', { error: loadError }) }}
      </div>
      <component
        :is="ToolComponent"
        v-else-if="ToolComponent"
        :initial-data="inputContent"
      />
      <div v-else class="p-8 text-center tool-not-found">
        Tool not found
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-view {
  color: var(--skin-text-main);
  background: transparent;
}

.tool-header {
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  position: relative;
}

.tool-back-btn {
  color: var(--skin-text-muted);
  transition: all 0.2s ease;
}

.tool-back-btn:hover {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.1);
}

.tool-title {
  color: var(--skin-text-strong);
}

.tool-not-found {
  color: var(--skin-text-muted);
}
</style>
