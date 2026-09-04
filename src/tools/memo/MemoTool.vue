<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NotebookPen, Pin, PinOff, Plus, Trash2 } from 'lucide-vue-next';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import {
  buildMonthOptions,
  clampPage,
  createNote,
  deleteNoteById,
  filterNotesByMonth,
  getNoteDisplayTitle,
  paginateNotes,
  searchNotes,
  sortNotes,
  toggleNotePinned,
  updateNote,
  type MemoNote,
} from './note-model';
import { loadNotes, saveNotes } from './note-storage';

const { t } = useI18n();
const appStore = useAppStore();
const PAGE_SIZE = 3;
const notes = ref<MemoNote[]>([]);
const searchKeyword = ref('');
const selectedMonth = ref('all');
const currentPage = ref(1);
const selectedNoteId = ref<string | null>(null);
const loaded = ref(false);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({
  minFirstWidth: 240,
  minSecondWidth: 360,
});

const monthOptions = computed(() => buildMonthOptions(notes.value));
const monthFilteredNotes = computed(() => filterNotesByMonth(notes.value, selectedMonth.value));
const searchedNotes = computed(() => searchNotes(monthFilteredNotes.value, searchKeyword.value));
const sortedVisibleNotes = computed(() => sortNotes(searchedNotes.value));
const totalPages = computed(() => Math.max(1, Math.ceil(sortedVisibleNotes.value.length / PAGE_SIZE)));
const paginatedNotes = computed(() => paginateNotes(sortedVisibleNotes.value, currentPage.value, PAGE_SIZE));
const selectedNote = computed(() => notes.value.find((note) => note.id === selectedNoteId.value) ?? null);

/**
 * 生成便签唯一标识，优先复用浏览器原生 UUID。
 */
const createNoteId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `memo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * 便签列表变化后，自动回退到一个仍然可见的选中项。
 */
const ensureSelectedNote = () => {
  if (selectedNote.value && paginatedNotes.value.some((note) => note.id === selectedNote.value?.id)) {
    return;
  }

  selectedNoteId.value = paginatedNotes.value[0]?.id ?? sortedVisibleNotes.value[0]?.id ?? notes.value[0]?.id ?? null;
};

/**
 * 将当前便签集合持久化到本地。
 */
const persistNotes = async () => {
  try {
    await saveNotes(notes.value);
  } catch {
    appStore.showToast(t('tools.memo.save_failed'), { type: 'error' });
  }
};

const createNewNote = async () => {
  const timestamp = new Date().toISOString();
  const nextNote = createNote(timestamp, createNoteId());
  notes.value = [nextNote, ...notes.value];
  selectedNoteId.value = nextNote.id;
  await persistNotes();
  appStore.showToast(t('tools.memo.created'), { type: 'success' });
};

const selectNote = (noteId: string) => {
  selectedNoteId.value = noteId;
};

const selectMonth = (monthKey: string) => {
  selectedMonth.value = monthKey;
};

const changePage = (nextPage: number) => {
  currentPage.value = clampPage(nextPage, totalPages.value);
};

const patchSelectedNote = async (patch: Partial<Pick<MemoNote, 'title' | 'content'>>) => {
  const current = selectedNote.value;
  if (!current) {
    return;
  }

  notes.value = notes.value.map((note) =>
    note.id === current.id ? updateNote(note, patch, new Date().toISOString()) : note,
  );
  await persistNotes();
};

const handleTogglePinned = async (noteId: string) => {
  notes.value = notes.value.map((note) =>
    note.id === noteId ? toggleNotePinned(note, new Date().toISOString()) : note,
  );
  await persistNotes();
  ensureSelectedNote();
};

const handleDeleteNote = async (noteId: string) => {
  notes.value = deleteNoteById(notes.value, noteId);
  if (selectedNoteId.value === noteId) {
    selectedNoteId.value = null;
  }
  ensureSelectedNote();
  await persistNotes();
  appStore.showToast(t('tools.memo.deleted'), { type: 'success' });
};

const getNotePreview = (note: MemoNote) => {
  const normalized = note.content.trim();
  return normalized || t('tools.memo.content_placeholder');
};

const formatUpdatedAt = (value: string) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

watch(searchKeyword, () => {
  currentPage.value = 1;
});

watch(selectedMonth, () => {
  currentPage.value = 1;
});

watch(totalPages, (nextTotalPages) => {
  currentPage.value = clampPage(currentPage.value, nextTotalPages);
});

watch([paginatedNotes, sortedVisibleNotes, notes], () => {
  ensureSelectedNote();
}, { deep: true });

onMounted(async () => {
  try {
    notes.value = await loadNotes();
  } catch {
    notes.value = [];
    appStore.showToast(t('tools.memo.load_failed'), { type: 'error' });
  } finally {
    loaded.value = true;
    ensureSelectedNote();
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
    <div class="flex items-center justify-between gap-3 border-b border-border p-4">
      <div class="flex items-center gap-3">
        <div class="rounded-xl bg-primary/10 p-2 text-primary">
          <NotebookPen class="h-5 w-5" />
        </div>
        <div>
          <h2 class="text-base font-semibold">{{ t('tools.memo.name') }}</h2>
          <p class="text-xs text-muted-foreground">{{ t('tools.memo.description') }}</p>
        </div>
      </div>
      <button
        data-testid="memo-create-button"
        type="button"
        class="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="createNewNote"
      >
        <Plus class="h-4 w-4" />
        {{ t('tools.memo.new_note') }}
      </button>
    </div>

    <div ref="containerRef" class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(240px,var(--panel-first-width,320px))_minmax(360px,1fr)]" :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }">
      <aside ref="firstPanelRef" class="relative flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div
          data-testid="memo-search-section"
          class="flex flex-col gap-3 border-b border-border p-4"
        >
          <div class="text-sm text-muted-foreground">{{ t('tools.memo.search_label') }}</div>
          <input
            v-model="searchKeyword"
            data-testid="memo-search-input"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            :placeholder="t('tools.memo.search_placeholder')"
          />
        </div>

        <div
          v-if="loaded && notes.length > 0"
          data-testid="memo-month-list"
          class="border-b border-border px-3 py-3"
        >
          <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">
            {{ t('tools.memo.month_archive') }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="month in monthOptions"
              :key="month.key"
              data-testid="memo-month-item"
              type="button"
              class="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors"
              :class="selectedMonth === month.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
              @click="selectMonth(month.key)"
            >
              <span>{{ month.key === 'all' ? t('tools.memo.month_all') : month.key }}</span>
              <span class="text-[11px] opacity-80">({{ month.count }})</span>
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-3">
          <div
            v-if="loaded && notes.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.memo.empty_list') }}
          </div>

          <div
            v-else-if="loaded && sortedVisibleNotes.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.memo.empty_search') }}
          </div>

          <div v-else class="flex flex-col gap-3">
            <button
              v-for="note in paginatedNotes"
              :key="note.id"
              data-testid="memo-list-item"
              type="button"
              class="w-full rounded-xl border p-3 text-left transition-colors"
              :class="selectedNoteId === note.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'"
              @click="selectNote(note.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium">
                      {{ getNoteDisplayTitle(note, t('tools.memo.empty_title')) }}
                    </span>
                    <span
                      v-if="note.pinned"
                      class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                    >
                      {{ t('tools.memo.pinned') }}
                    </span>
                  </div>
                  <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {{ getNotePreview(note) }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :title="note.pinned ? t('tools.memo.unpin') : t('tools.memo.pin')"
                    @click.stop="handleTogglePinned(note.id)"
                  >
                    <PinOff v-if="note.pinned" class="h-4 w-4" />
                    <Pin v-else class="h-4 w-4" />
                  </button>
                  <button
                    data-testid="memo-delete-button"
                    type="button"
                    class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    :title="t('tools.memo.delete')"
                    @click.stop="handleDeleteNote(note.id)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div class="mt-3 text-[11px] text-muted-foreground">
                {{ formatUpdatedAt(note.updatedAt) }}
              </div>
            </button>

            <div
              v-if="sortedVisibleNotes.length > 0"
              data-testid="memo-pagination"
              class="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
            >
              <button
                data-testid="memo-prev-page"
                type="button"
                class="rounded-md px-2 py-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="currentPage <= 1"
                @click="changePage(currentPage - 1)"
              >
                {{ t('tools.memo.prev_page') }}
              </button>
              <span>{{ currentPage }} / {{ totalPages }}</span>
              <button
                data-testid="memo-next-page"
                type="button"
                class="rounded-md px-2 py-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="currentPage >= totalPages"
                @click="changePage(currentPage + 1)"
              >
                {{ t('tools.memo.next_page') }}
              </button>
            </div>
          </div>
        </div>
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.memo.resize_aria')" aria-orientation="vertical" :aria-valuenow="firstPanelWidth ?? firstPanelRef?.clientWidth ?? 240" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </aside>

      <section class="flex min-h-0 flex-col overflow-hidden">
        <div v-if="selectedNote" class="flex h-full min-h-0 flex-col">
          <div class="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div
              data-testid="memo-title-section"
              class="flex flex-col gap-3"
            >
              <div class="text-sm text-muted-foreground">{{ t('tools.memo.title_label') }}</div>
            <input
              data-testid="memo-title-input"
              :value="selectedNote.title"
              type="text"
              class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              :placeholder="t('tools.memo.title_placeholder')"
              @input="patchSelectedNote({ title: ($event.target as HTMLInputElement).value })"
            />
            </div>

            <div class="text-sm text-muted-foreground">{{ t('tools.memo.content_label') }}</div>
            <textarea
              data-testid="memo-content-input"
              :value="selectedNote.content"
              class="min-h-0 flex-1 resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none transition-colors focus:border-primary"
              :placeholder="t('tools.memo.content_placeholder')"
              @input="patchSelectedNote({ content: ($event.target as HTMLTextAreaElement).value })"
            ></textarea>
          </div>
        </div>

        <div v-else class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          {{ t('tools.memo.empty_list') }}
        </div>
      </section>
    </div>
  </div>
</template>
