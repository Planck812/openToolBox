<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { applyThemeMode, type ThemeMode, type ThemeSkinId } from '@/lib/theme';
import { Minus, Square, X, GitBranch } from 'lucide-vue-next';
import { useGitDataStore } from './stores/gitdata';
import { useReposStore } from './stores/repos';

const router = useRouter();
const gitData = useGitDataStore();
const reposStore = useReposStore();
const appWindow = getCurrentWindow();
let unlistenTheme: UnlistenFn | null = null;

const title = computed(() => {
  if (!gitData.repoPath) {
    return 'Mini-Git';
  }
  const repoName = gitData.repoPath.split(/[/\\]/).filter(Boolean).pop() || '仓库';
  const state = gitData.repoState;
  if (!state) {
    return `${repoName} · 加载中...`;
  }

  let branchDisplay = state.head_name || '未知分支';
  if (state.is_detached && state.head_oid) {
    branchDisplay = `游离 (${state.head_oid.slice(0, 7)})`;
  }

  const extraState = state.state !== 'Normal' ? ` [${state.state}]` : '';
  return `${repoName} · ${branchDisplay}${extraState}`;
});

const minimize = () => appWindow.minimize();
const toggleMaximize = () => appWindow.toggleMaximize();
const closeWindow = () => appWindow.close();

onMounted(async () => {
  listen<{ mode: ThemeMode; skinId: ThemeSkinId }>('theme_changed', (e) => {
    applyThemeMode(e.payload.mode, e.payload.skinId);
  }).then((fn) => {
    unlistenTheme = fn;
  }).catch(() => {});

  reposStore.load();
  // Cold start decision (TC-1.31 ~ TC-1.35)
  const sorted = reposStore.sortedRepos;
  if (sorted.length > 0) {
    const lastRepo = sorted[0];
    if (lastRepo.isValid) {
      try {
        await gitData.openRepo(lastRepo.path);
        router.replace({ path: '/workspace', query: { path: lastRepo.path } });
      } catch {
        reposStore.markInvalid(lastRepo.path, '仓库无法打开');
        router.replace('/');
      }
    }
  }
});

onUnmounted(() => {
  unlistenTheme?.();
  unlistenTheme = null;
});
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground select-none font-sans text-xs">
    <!-- Title Bar -->
    <header
      data-tauri-drag-region
      class="h-8 min-h-[32px] bg-muted/40 border-b border-border/60 flex items-center justify-between px-3 z-50 text-xs"
    >
      <div class="flex items-center gap-2 pointer-events-none">
        <GitBranch class="w-3.5 h-3.5 text-primary" />
        <span class="font-medium text-foreground/90 truncate max-w-md">{{ title }}</span>
      </div>

      <!-- Window controls -->
      <div class="flex items-center space-x-1 -mr-1">
        <button
          type="button"
          class="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
          title="最小化"
          @click="minimize"
        >
          <Minus class="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          class="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
          title="最大化 / 还原"
          @click="toggleMaximize"
        >
          <Square class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="p-1 hover:bg-destructive hover:text-destructive-foreground rounded text-muted-foreground transition-colors"
          title="关闭"
          @click="closeWindow"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </header>

    <!-- Main Router Content -->
    <main class="flex-1 overflow-hidden relative">
      <router-view />
    </main>
  </div>
</template>
