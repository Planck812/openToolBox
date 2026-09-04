<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Check,
  Copy,
  ExternalLink,
  PackageOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-vue-next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAppStore } from '@/store/app';
import { copyText } from '@/lib/clipboard';
import {
  collectTags,
  createPrompt,
  filterPromptsByTag,
  getPromptDisplayTitle,
  getPromptPreview,
  parseTagsInput,
  removePromptById,
  searchPrompts,
  sortPrompts,
  togglePromptPinned,
  updatePrompt,
  type PromptItem,
} from './prompt-model';
import { presetPrompts } from './preset-prompts';
import {
  loadDeletedPresetIds,
  loadUserPrompts,
  saveDeletedPresetIds,
  saveUserPrompts,
} from './prompt-storage';

const { t } = useI18n();
const appStore = useAppStore();

const userPrompts = ref<PromptItem[]>([]);
const deletedPresetIds = ref<string[]>([]);
const searchKeyword = ref('');
const selectedTag = ref('all');
const selectedPromptId = ref<string | null>(null);
const loaded = ref(false);
const editing = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);

/**
 * 新建流程会主动改写 selectedPromptId 并进入编辑态，
 * 用它豁免“切换选中项即退出编辑”的 watch 重置。
 */
let skipNextEditingReset = false;

const builtinPrompts = computed(() =>
  presetPrompts.filter((prompt) => !deletedPresetIds.value.includes(prompt.id)),
);
const allPrompts = computed(() => sortPrompts([...builtinPrompts.value, ...userPrompts.value]));
const tagOptions = computed(() => collectTags(allPrompts.value));
const visiblePrompts = computed(() =>
  filterPromptsByTag(searchPrompts(allPrompts.value, searchKeyword.value), selectedTag.value),
);
const selectedPrompt = computed(
  () => allPrompts.value.find((prompt) => prompt.id === selectedPromptId.value) ?? null,
);
const canEditSelected = computed(
  () => Boolean(selectedPrompt.value && !selectedPrompt.value.preset),
);

/**
 * 生成提示词唯一标识，优先复用浏览器原生 UUID。
 */
const createPromptId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * 列表变化后，自动回退到一个仍然可见的选中项。
 */
const ensureSelectedPrompt = () => {
  if (selectedPrompt.value && visiblePrompts.value.some((prompt) => prompt.id === selectedPrompt.value?.id)) {
    return;
  }

  selectedPromptId.value =
    visiblePrompts.value[0]?.id ?? allPrompts.value.find((prompt) => !prompt.preset)?.id ?? allPrompts.value[0]?.id ?? null;
};

const persistUserPrompts = async () => {
  try {
    await saveUserPrompts(userPrompts.value);
  } catch {
    appStore.showToast(t('tools.prompt_manager.save_failed'), { type: 'error' });
  }
};

const persistDeletedPresetIds = async () => {
  try {
    await saveDeletedPresetIds(deletedPresetIds.value);
  } catch {
    appStore.showToast(t('tools.prompt_manager.save_failed'), { type: 'error' });
  }
};

const selectPrompt = (promptId: string) => {
  selectedPromptId.value = promptId;
};

const selectTag = (tag: string) => {
  selectedTag.value = tag;
};

const enterEditing = async () => {
  if (!canEditSelected.value) {
    return;
  }

  editing.value = true;
  await nextTick();
  titleInputRef.value?.focus();
};

const handleCreate = async () => {
  const timestamp = new Date().toISOString();
  const nextPrompt = createPrompt(
    { title: '', content: '', tags: [], sourceUrl: '' },
    timestamp,
    createPromptId(),
  );
  userPrompts.value = [nextPrompt, ...userPrompts.value];
  skipNextEditingReset = true;
  selectedPromptId.value = nextPrompt.id;
  editing.value = true;
  selectedTag.value = 'all';
  searchKeyword.value = '';
  await persistUserPrompts();
  appStore.showToast(t('tools.prompt_manager.created'), { type: 'success' });
  await nextTick();
  titleInputRef.value?.focus();
};

const patchSelectedPrompt = async (
  patch: Partial<Pick<PromptItem, 'title' | 'content' | 'tags' | 'sourceUrl'>>,
) => {
  const current = selectedPrompt.value;
  if (!current || current.preset) {
    return;
  }

  userPrompts.value = userPrompts.value.map((prompt) =>
    prompt.id === current.id ? updatePrompt(prompt, patch, new Date().toISOString()) : prompt,
  );
  await persistUserPrompts();
};

const handleCopy = async (prompt: PromptItem) => {
  const ok = await copyText(prompt.content);
  if (ok) {
    appStore.showToast(t('tools.prompt_manager.copied'), { type: 'success' });
  } else {
    appStore.showToast(t('tools.prompt_manager.copy_failed'), { type: 'error' });
  }
};

const handleTogglePinned = async (promptId: string) => {
  userPrompts.value = userPrompts.value.map((prompt) =>
    prompt.id === promptId ? togglePromptPinned(prompt, new Date().toISOString()) : prompt,
  );
  await persistUserPrompts();
};

const handleDelete = async (prompt: PromptItem) => {
  if (prompt.preset) {
    deletedPresetIds.value = [...deletedPresetIds.value, prompt.id];
    await persistDeletedPresetIds();
  } else {
    userPrompts.value = removePromptById(userPrompts.value, prompt.id);
    await persistUserPrompts();
  }
  if (selectedPromptId.value === prompt.id) {
    selectedPromptId.value = null;
  }
  ensureSelectedPrompt();
  appStore.showToast(t('tools.prompt_manager.deleted'), { type: 'success' });
};

/**
 * 把任意提示词（含内置）另存为一份可编辑的用户副本。
 */
const handleDuplicate = async (prompt: PromptItem) => {
  const timestamp = new Date().toISOString();
  const copy = createPrompt(
    {
      title: t('tools.prompt_manager.copy_title_suffix', { title: getPromptDisplayTitle(prompt, t('tools.prompt_manager.untitled')) }),
      content: prompt.content,
      tags: [...prompt.tags],
      sourceUrl: prompt.sourceUrl,
    },
    timestamp,
    createPromptId(),
  );
  userPrompts.value = [copy, ...userPrompts.value];
  selectedPromptId.value = copy.id;
  await persistUserPrompts();
  appStore.showToast(t('tools.prompt_manager.duplicated'), { type: 'success' });
};

const handleOpenSource = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    appStore.showToast(t('tools.prompt_manager.open_source_failed'), { type: 'error' });
  }
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

/**
 * Ctrl+E 在浏览/编辑间切换；工具组件被 keep-alive 缓存，
 * 监听器必须随激活状态挂摘，避免干扰其他工具页。
 */
const handleGlobalKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
    if (!canEditSelected.value) {
      return;
    }
    event.preventDefault();
    if (editing.value) {
      editing.value = false;
    } else {
      void enterEditing();
    }
    return;
  }

  // 中文输入法组合期间 Esc 用于取消候选词，不应顺带退出编辑态。
  if (event.key === 'Escape' && editing.value && !event.isComposing) {
    editing.value = false;
  }
};

onActivated(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onDeactivated(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

watch(searchKeyword, () => {
  ensureSelectedPrompt();
});

watch(selectedTag, () => {
  ensureSelectedPrompt();
});

watch(selectedPromptId, () => {
  if (skipNextEditingReset) {
    skipNextEditingReset = false;
    return;
  }
  editing.value = false;
});

onMounted(async () => {
  try {
    const [prompts, deletedIds] = await Promise.all([loadUserPrompts(), loadDeletedPresetIds()]);
    userPrompts.value = prompts;
    deletedPresetIds.value = deletedIds;
  } catch {
    userPrompts.value = [];
    deletedPresetIds.value = [];
    appStore.showToast(t('tools.prompt_manager.load_failed'), { type: 'error' });
  } finally {
    loaded.value = true;
    ensureSelectedPrompt();
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div class="text-sm text-muted-foreground">
        {{ t('tools.prompt_manager.count_summary', { count: allPrompts.length }) }}
      </div>
      <button
        data-testid="prompt-create-button"
        type="button"
        class="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="handleCreate"
      >
        <Plus class="h-4 w-4" />
        {{ t('tools.prompt_manager.new_prompt') }}
      </button>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(260px,340px)_minmax(360px,1fr)]">
      <aside class="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div class="border-b border-border p-4">
          <input
            v-model="searchKeyword"
            data-testid="prompt-search-input"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            :placeholder="t('tools.prompt_manager.search_placeholder')"
          />
        </div>

        <div v-if="loaded && tagOptions.length > 0" class="border-b border-border px-3 py-3">
          <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">
            {{ t('tools.prompt_manager.tag_filter_label') }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in ['all', ...tagOptions]"
              :key="tag"
              data-testid="prompt-tag-item"
              type="button"
              class="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors"
              :class="selectedTag === tag ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'"
              @click="selectTag(tag)"
            >
              <span>{{ tag === 'all' ? t('tools.prompt_manager.tag_all') : tag }}</span>
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-3">
          <div
            v-if="loaded && visiblePrompts.length === 0 && allPrompts.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.prompt_manager.empty_list') }}
          </div>

          <div
            v-else-if="loaded && visiblePrompts.length === 0"
            class="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.prompt_manager.empty_search') }}
          </div>

          <div v-else class="flex flex-col gap-3">
            <button
              v-for="prompt in visiblePrompts"
              :key="prompt.id"
              data-testid="prompt-list-item"
              type="button"
              class="group w-full rounded-xl border p-3 text-left transition-colors"
              :class="selectedPromptId === prompt.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'"
              @click="selectPrompt(prompt.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium">
                      {{ getPromptDisplayTitle(prompt, t('tools.prompt_manager.untitled')) }}
                    </span>
                    <span
                      v-if="prompt.pinned"
                      class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                    >
                      {{ t('tools.prompt_manager.pinned') }}
                    </span>
                    <span
                      v-if="prompt.preset"
                      class="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      {{ t('tools.prompt_manager.preset_badge') }}
                    </span>
                  </div>
                  <p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {{ getPromptPreview(prompt, t('tools.prompt_manager.content_placeholder')) }}
                  </p>
                  <div class="mt-2 flex items-center gap-1">
                    <template v-if="prompt.tags.length > 0">
                      <span
                        v-for="tag in prompt.tags"
                        :key="tag"
                        class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {{ tag }}
                      </span>
                    </template>
                    <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {{ formatUpdatedAt(prompt.updatedAt) }}
                    </span>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    v-if="!prompt.preset"
                    type="button"
                    class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :title="prompt.pinned ? t('tools.prompt_manager.unpin') : t('tools.prompt_manager.pin')"
                    @click.stop="handleTogglePinned(prompt.id)"
                  >
                    <PinOff v-if="prompt.pinned" class="h-4 w-4" />
                    <Pin v-else class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :title="t('tools.prompt_manager.copy')"
                    @click.stop="handleCopy(prompt)"
                  >
                    <Copy class="h-4 w-4" />
                  </button>
                  <button
                    data-testid="prompt-delete-button"
                    type="button"
                    class="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    :title="t('tools.prompt_manager.delete')"
                    @click.stop="handleDelete(prompt)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </button>
          </div>
        </div>
      </aside>

      <section class="flex min-h-0 flex-col overflow-hidden">
        <div v-if="selectedPrompt" class="flex h-full min-h-0 flex-col">
          <div class="shrink-0 border-b border-border px-4 py-2.5">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <h3 class="truncate text-lg font-semibold">
                  {{ getPromptDisplayTitle(selectedPrompt, t('tools.prompt_manager.untitled')) }}
                </h3>
                <span
                  v-if="selectedPrompt.pinned"
                  class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                >
                  {{ t('tools.prompt_manager.pinned') }}
                </span>
                <span
                  v-if="selectedPrompt.preset"
                  class="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                >
                  {{ t('tools.prompt_manager.preset_badge') }}
                </span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  data-testid="prompt-copy-button"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  @click="handleCopy(selectedPrompt)"
                >
                  <Copy class="h-3.5 w-3.5" />
                  {{ t('tools.prompt_manager.copy') }}
                </button>
                <button
                  v-if="!editing"
                  data-testid="prompt-edit-button"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
                  :disabled="!canEditSelected"
                  @click="enterEditing"
                >
                  <Pencil class="h-3.5 w-3.5" />
                  {{ t('tools.prompt_manager.edit') }}
                </button>
                <button
                  v-else
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
                  @click="editing = false"
                >
                  <Check class="h-3.5 w-3.5" />
                  {{ t('tools.prompt_manager.finish_edit') }}
                </button>
                <button
                  v-if="selectedPrompt.preset"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
                  :title="t('tools.prompt_manager.preset_readonly_hint')"
                  @click="handleDuplicate(selectedPrompt)"
                >
                  <PackageOpen class="h-3.5 w-3.5" />
                  {{ t('tools.prompt_manager.duplicate') }}
                </button>
                <button
                  type="button"
                  class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  :title="t('tools.prompt_manager.delete')"
                  @click="handleDelete(selectedPrompt)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div v-if="!editing" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              <span
                v-for="tag in selectedPrompt.tags"
                :key="tag"
                class="rounded-full bg-muted px-2 py-0.5 text-[10px]"
              >
                {{ tag }}
              </span>
              <button
                v-if="selectedPrompt.sourceUrl"
                type="button"
                class="inline-flex items-center gap-1 break-all text-left text-xs text-primary underline-offset-4 hover:underline"
                @click="handleOpenSource(selectedPrompt.sourceUrl)"
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0" />
                {{ t('tools.prompt_manager.source_label') }}
              </button>
              <span class="ml-auto shrink-0">
                {{ formatUpdatedAt(selectedPrompt.updatedAt) }}
              </span>
            </div>
          </div>

          <div v-if="!editing" class="min-h-0 flex-1 overflow-auto p-4">
            <div
              data-testid="prompt-content-display"
              class="max-w-[860px] whitespace-pre-wrap text-[15px] leading-7"
            >{{ selectedPrompt.content }}</div>
          </div>

          <div v-else class="min-h-0 flex-1 p-4">
            <div class="flex h-full min-h-0 max-w-[860px] flex-col gap-3">
              <div class="grid gap-3 md:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                  <div class="text-sm text-muted-foreground">{{ t('tools.prompt_manager.title_label') }}</div>
                  <input
                    ref="titleInputRef"
                    data-testid="prompt-title-input"
                    :value="selectedPrompt.title"
                    type="text"
                    class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                    :placeholder="t('tools.prompt_manager.title_placeholder')"
                    @input="patchSelectedPrompt({ title: ($event.target as HTMLInputElement).value })"
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <div class="text-sm text-muted-foreground">{{ t('tools.prompt_manager.tags_label') }}</div>
                  <input
                    data-testid="prompt-tags-input"
                    :value="selectedPrompt.tags.join(', ')"
                    type="text"
                    class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                    :placeholder="t('tools.prompt_manager.tags_placeholder')"
                    @change="patchSelectedPrompt({ tags: parseTagsInput(($event.target as HTMLInputElement).value) })"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="text-sm text-muted-foreground">{{ t('tools.prompt_manager.source_label') }}</div>
                <input
                  data-testid="prompt-source-input"
                  :value="selectedPrompt.sourceUrl"
                  type="text"
                  class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                  :placeholder="t('tools.prompt_manager.source_placeholder')"
                  @change="patchSelectedPrompt({ sourceUrl: ($event.target as HTMLInputElement).value.trim() })"
                />
              </div>

              <div class="flex min-h-0 flex-1 flex-col gap-1.5">
                <div class="text-sm text-muted-foreground">{{ t('tools.prompt_manager.content_label') }}</div>
                <textarea
                  data-testid="prompt-content-input"
                  :value="selectedPrompt.content"
                  class="min-h-0 flex-1 resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none transition-colors focus:border-primary"
                  :placeholder="t('tools.prompt_manager.content_placeholder')"
                  @input="patchSelectedPrompt({ content: ($event.target as HTMLTextAreaElement).value })"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          {{ t('tools.prompt_manager.empty_selection') }}
        </div>
      </section>
    </div>
  </div>
</template>
