<script setup lang="ts">
/**
 * 便利贴管理工具页：列出便利贴、按分组贴出、新建、删除。
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, StickyNote as StickyNoteIcon, Trash2, Pin, FileText } from 'lucide-vue-next';
import {
  stickyCreate,
  stickyDelete,
  stickyList,
  stickyShowGroup,
  stickySingleStatus,
  stickySingleToggle,
  type StickyNoteData,
} from '@/lib/ipc/sticky';

const { t } = useI18n();
const notes = ref<StickyNoteData[]>([]);
const errorMessage = ref('');
const loading = ref(false);
/** 单便利贴是否已打开（按钮文案/高亮）。 */
const isSingleOpen = ref(false);

const colorMap: Record<string, string> = {
  mint: '#c8f7c5',
  yellow: '#fff3b0',
  blue: '#c5e8ff',
  pink: '#ffd6e0',
  purple: '#e3d5ff',
};

const loadNotes = async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    notes.value = await stickyList();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  } finally {
    loading.value = false;
  }
};

/** 按分组聚合。 */
const groupedNotes = () => {
  const groups = new Map<string, StickyNoteData[]>();
  for (const n of notes.value) {
    if (!groups.has(n.group)) groups.set(n.group, []);
    groups.get(n.group)!.push(n);
  }
  return Array.from(groups.entries());
};

/** 新建便利贴（贴出一个空便利贴）。 */
const createNote = async () => {
  try {
    await stickyCreate();
    await loadNotes();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 读取单便利贴当前开关状态（初始化按钮文案/高亮）。 */
const loadSingleStatus = async () => {
  try {
    const status = await stickySingleStatus();
    isSingleOpen.value = status.open;
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 单便利贴开关：打开/收起。后端保证窗口唯一（已打开时聚焦而非重复开）。 */
const toggleSingleNote = async () => {
  try {
    const status = await stickySingleToggle();
    isSingleOpen.value = status.open;
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 贴出某分组全部便利贴。 */
const showGroup = async (group: string) => {
  try {
    const count = await stickyShowGroup(group);
    errorMessage.value = count > 0 ? t('tools.sticky_manager.showed_group', { count }) : t('tools.sticky_manager.group_empty', { group });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 贴出单个便利贴（若窗口已关）。 */
const showNote = async (id: string) => {
  const target = notes.value.find((n) => n.id === id);
  if (!target) {
    // 列表过期（便利贴已在其窗口被删除）：刷新列表，避免传给后端 undefined 生成空白新便利贴。
    errorMessage.value = t('tools.sticky_manager.note_missing');
    await loadNotes();
    return;
  }
  try {
    await stickyCreate(target);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    // 便利贴可能已被删除：刷新列表移除过期项。
    await loadNotes();
  }
};

/** 删除便利贴。 */
const deleteNote = async (id: string) => {
  try {
    await stickyDelete(id);
    await loadNotes();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

onMounted(() => {
  void loadNotes();
  void loadSingleStatus();
  // 便利贴可能在其窗口中删除（关闭按钮=删除）。窗口失焦再回到主窗口时刷新列表，
  // 移除过期 ghost 项，避免「贴出/删除一个已不存在的便利贴」。
  window.addEventListener('focus', refreshOnFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshOnFocus);
});

let focusTimer: ReturnType<typeof setTimeout> | null = null;
const refreshOnFocus = () => {
  if (focusTimer) clearTimeout(focusTimer);
  // 防抖：主窗口聚焦频繁触发，避免反复读 store。
  focusTimer = setTimeout(() => {
    void loadNotes();
    // 单便利贴可能已在其窗口被 X 关闭（窗口销毁）：同步按钮开关状态，
    // 避免显示「收起」却实际已关（再次点击会重新打开而非收起）。
    void loadSingleStatus();
  }, 150);
};
</script>

<template>
  <div class="h-full overflow-auto bg-background text-foreground">
    <div class="mx-auto max-w-4xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('tools.sticky_manager.title') }}</h2>
        <div class="flex items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            :class="isSingleOpen
              ? 'bg-secondary text-secondary-foreground ring-1 ring-primary'
              : 'bg-primary text-primary-foreground hover:opacity-90'"
            :title="t('tools.sticky_manager.single_label')"
            @click="toggleSingleNote"
          >
            <FileText class="h-4 w-4" />
            {{ isSingleOpen ? t('tools.sticky_manager.single_close') : t('tools.sticky_manager.single_open') }}
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="createNote"
          >
            <Plus class="h-4 w-4" />
            {{ t('tools.sticky_manager.new_note') }}
          </button>
        </div>
      </div>

      <div v-if="errorMessage" class="mb-4 rounded-lg border border-border bg-muted px-4 py-2 text-sm">
        {{ errorMessage }}
      </div>

      <div v-if="loading" class="py-8 text-center text-sm text-muted-foreground">{{ t('tools.sticky_manager.loading') }}</div>
      <div v-else-if="notes.length === 0" class="py-12 text-center text-sm text-muted-foreground">
        {{ t('tools.sticky_manager.empty') }}
      </div>

      <!-- 按分组展示 -->
      <div v-for="[group, items] in groupedNotes()" :key="group" class="mb-6">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-muted-foreground">
            {{ t('tools.sticky_manager.group_count', { group, count: items.length }) }}
          </h3>
          <button
            class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
            @click="showGroup(group)"
          >
            <Pin class="h-3.5 w-3.5" />
            {{ t('tools.sticky_manager.show_group') }}
          </button>
        </div>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));">
          <div
            v-for="n in items"
            :key="n.id"
            class="flex flex-col rounded-xl border border-border p-3 shadow-sm"
            :style="{ background: colorMap[n.color] ?? '#c8f7c5' }"
          >
            <div class="mb-2 line-clamp-3 min-h-[60px] whitespace-pre-wrap text-sm" style="color: #2d4a2d;">
              {{ n.text || t('tools.sticky_manager.empty_text') }}
            </div>
            <div class="mt-auto flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{{ n.color }}</span>
              <div class="flex gap-1">
                <button
                  class="rounded-md p-1.5 transition-colors hover:bg-black/10"
                  :title="t('tools.sticky_manager.show')"
                  @click="showNote(n.id)"
                >
                  <StickyNoteIcon class="h-3.5 w-3.5" />
                </button>
                <button
                  class="rounded-md p-1.5 transition-colors hover:bg-red-500/20"
                  :title="t('tools.sticky_manager.delete')"
                  @click="deleteNote(n.id)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
