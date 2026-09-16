<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  FolderGit2,
  Search,
  Plus,
  AlertTriangle,
  Clock,
  Trash2,
  RefreshCw,
  FolderOpen,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { useReposStore, type RepoEntry } from '../stores/repos';
import { useGitDataStore } from '../stores/gitdata';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const router = useRouter();
const reposStore = useReposStore();
const gitData = useGitDataStore();

const searchInputRef = ref<HTMLInputElement | null>(null);
const errorMessage = ref('');
const isAdding = ref(false);

const filteredList = computed(() => reposStore.filteredRepos);

onMounted(() => {
  reposStore.load();
  if (reposStore.filteredRepos.length > 0) {
    reposStore.selectedIndex = 0;
  }
  searchInputRef.value?.focus();
});

const onKeydown = (e: KeyboardEvent) => {
  const list = filteredList.value;
  if (list.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    reposStore.selectedIndex = Math.min(reposStore.selectedIndex + 1, list.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    reposStore.selectedIndex = Math.max(reposStore.selectedIndex - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = list[reposStore.selectedIndex]?.repo;
    if (item) {
      enterRepo(item);
    }
  }
};

const enterRepo = async (repo: RepoEntry) => {
  errorMessage.value = '';
  try {
    await gitData.openRepo(repo.path);
    reposStore.touchRepo(repo.path);
    router.push({ path: '/workspace', query: { path: repo.path } });
  } catch (err: any) {
    const msg = (err && typeof err === 'object' && 'message' in err)
      ? err.message
      : (typeof err === 'string' ? err : '仓库无法打开');
    reposStore.markInvalid(repo.path, msg);
    errorMessage.value = `打开失败：${msg}`;
  }
};

const handleAddRepo = async () => {
  errorMessage.value = '';
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '选择 Git 仓库根目录',
    });

    if (selected && typeof selected === 'string') {
      isAdding.value = true;
      const repo = await reposStore.addRepo(selected);
      await enterRepo(repo);
    }
  } catch (err: any) {
    const msg = (err && typeof err === 'object' && 'message' in err)
      ? err.message
      : (typeof err === 'string' ? err : '添加仓库失败');
    errorMessage.value = msg;
  } finally {
    isAdding.value = false;
  }
};

const handleRelocate = async (repo: RepoEntry) => {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '重新选择 Git 仓库根目录',
    });
    if (selected && typeof selected === 'string') {
      await reposStore.relocateRepo(repo.path, selected);
    }
  } catch (err: any) {
    const msg = (err && typeof err === 'object' && 'message' in err)
      ? err.message
      : (typeof err === 'string' ? err : '重新定位失败');
    errorMessage.value = msg;
  }
};

const handleRemove = (repo: RepoEntry) => {
  reposStore.removeRepo(repo.path);
};

const formatTime = (ts: number) => {
  if (!ts) return '';
  return dayjs(ts).fromNow();
};
</script>

<template>
  <div class="h-full flex flex-col bg-background p-6 max-w-3xl mx-auto select-none" @keydown="onKeydown">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center space-x-2">
        <FolderGit2 class="w-6 h-6 text-primary" />
        <h1 class="text-base font-semibold text-foreground">仓库选择</h1>
      </div>
      <button
        type="button"
        class="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        :disabled="isAdding"
        @click="handleAddRepo"
      >
        <Plus class="w-3.5 h-3.5" />
        <span>{{ isAdding ? '添加中...' : '添加仓库' }}</span>
      </button>
    </div>

    <!-- Search Input -->
    <div class="relative mb-3">
      <Search class="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
      <input
        ref="searchInputRef"
        v-model="reposStore.searchKeyword"
        type="text"
        placeholder="搜索仓库名称或路径 (支持模糊匹配，↑ ↓ 导航，回车进入)..."
        class="w-full pl-9 pr-3 py-2 bg-muted/50 border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-all"
        @input="reposStore.selectedIndex = 0"
      />
    </div>

    <!-- Error Banner -->
    <div
      v-if="errorMessage"
      class="mb-3 p-2.5 bg-destructive/10 border border-destructive/30 rounded flex items-center space-x-2 text-destructive text-xs"
    >
      <AlertTriangle class="w-4 h-4 flex-shrink-0" />
      <span class="truncate flex-1">{{ errorMessage }}</span>
      <button type="button" class="text-xs hover:underline" @click="errorMessage = ''">关闭</button>
    </div>

    <!-- Repo List Area -->
    <div class="flex-1 overflow-y-auto border border-border/80 rounded bg-card/60 divide-y divide-border/60">
      <!-- Empty states -->
      <div
        v-if="reposStore.repos.length === 0"
        class="h-64 flex flex-col items-center justify-center text-muted-foreground space-y-3"
      >
        <FolderOpen class="w-10 h-10 stroke-[1.5] text-muted-foreground/60" />
        <p class="text-xs font-medium">暂无已登记仓库</p>
        <p class="text-[11px] text-muted-foreground/80">点击右上角「添加仓库」选择本地 Git 仓库开始审阅</p>
      </div>

      <div
        v-else-if="filteredList.length === 0"
        class="h-48 flex flex-col items-center justify-center text-muted-foreground space-y-2"
      >
        <Search class="w-8 h-8 stroke-[1.5] text-muted-foreground/60" />
        <p class="text-xs">未找到与「{{ reposStore.searchKeyword }}」匹配的仓库</p>
      </div>

      <!-- Repo items -->
      <div
        v-for="(item, idx) in filteredList"
        :key="item.repo.id"
        class="group p-3 flex items-center justify-between cursor-pointer transition-colors border-l-4"
        :class="[
          reposStore.selectedIndex === idx ? 'bg-accent/60' : 'hover:bg-muted/50',
          !item.repo.isValid ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-transparent'
        ]"
        @click="reposStore.selectedIndex = idx"
        @dblclick="enterRepo(item.repo)"
      >
        <div class="flex-1 min-w-0 pr-4">
          <div class="flex items-center space-x-2">
            <span class="font-medium text-foreground truncate">{{ item.repo.name }}</span>
            <span
              v-if="!item.repo.isValid"
              class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle class="w-3 h-3 mr-1" />
              {{ item.repo.errorReason || '路径不存在或失效' }}
            </span>
          </div>
          <p class="text-[11px] text-muted-foreground truncate mt-0.5" :title="item.repo.path">
            {{ item.repo.path }}
          </p>
        </div>

        <div class="flex items-center space-x-3 text-muted-foreground text-[11px] flex-shrink-0">
          <span class="flex items-center space-x-1" :title="dayjs(item.repo.lastOpened).format('YYYY-MM-DD HH:mm:ss')">
            <Clock class="w-3 h-3" />
            <span>{{ formatTime(item.repo.lastOpened) }}</span>
          </span>

          <!-- Actions on hover / selection -->
          <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              v-if="!item.repo.isValid"
              type="button"
              class="p-1 hover:bg-muted rounded text-foreground transition-colors"
              title="重新定位"
              @click.stop="handleRelocate(item.repo)"
            >
              <RefreshCw class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              class="p-1 hover:bg-destructive/20 hover:text-destructive rounded transition-colors"
              title="移除"
              @click.stop="handleRemove(item.repo)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Action Bar -->
    <div class="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>已登记 {{ reposStore.repos.length }} 个仓库</span>
      <button
        type="button"
        class="px-4 py-1.5 bg-secondary text-secondary-foreground font-medium rounded hover:bg-secondary/80 transition-colors disabled:opacity-50"
        :disabled="filteredList.length === 0"
        @click="reposStore.selectedRepo && enterRepo(reposStore.selectedRepo)"
      >
        进入仓库
      </button>
    </div>
  </div>
</template>
