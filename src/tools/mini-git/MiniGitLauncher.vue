<script setup lang="ts">
import { onMounted } from 'vue';
import { GitBranch, ExternalLink } from 'lucide-vue-next';
import { commands } from '@/lib/ipc/bindings';

const openWindow = () => {
  commands.residentOpen('mini-git');
};

onMounted(() => {
  openWindow();
});
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center space-y-4 p-8 text-center select-none">
    <div class="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
      <GitBranch class="w-7 h-7" />
    </div>
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-foreground">Mini-Git (Git 审阅器)</h2>
      <p class="text-xs text-muted-foreground max-w-sm">
        Mini-Git 运行在独立常驻窗口中，正在为您打开独立窗口...
      </p>
    </div>
    <button
      type="button"
      class="px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded shadow hover:bg-primary/90 flex items-center space-x-1.5"
      @click="openWindow"
    >
      <ExternalLink class="w-3.5 h-3.5" />
      <span>打开 Mini-Git 窗口</span>
    </button>
  </div>
</template>
