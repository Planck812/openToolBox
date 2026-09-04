import { computed, ref } from 'vue';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { Code2, Hash, Link2, Scissors, Sparkles } from 'lucide-vue-next';
import { splitTextToList } from '@/tools/text-split';
import { joinTextLines } from '@/tools/text-join';
import { dedupLines } from '@/tools/text-dedup';
import { processText } from '@/tools/text-processor';
import { copyText } from '@/lib/clipboard';

/**
 * 首页「快速处理工作区」状态与动作（拆分自 HomeView.vue）。
 *
 * 独立于首页的键盘导航/拖拽排序子系统：只处理「把输入内容做一次
 * 快捷处理并复制」的动作编排。
 */
export function useQuickActions(deps: { getInputContent: () => string }) {
  const store = useAppStore();
  const { t } = useI18n();

  const quickResult = ref('');
  const quickJoinPrefix = ref('');
  const activeQuickActionKey = ref<string | null>(null);
  const hasActivatedQuickWorkbench = ref(false);

  const quickActionIcons = [Scissors, Sparkles, Hash, Code2, Link2];

  const updateQuickResult = (actionKey: string, result: string) => {
    activeQuickActionKey.value = actionKey;
    quickResult.value = result;
  };

  const copyToClipboard = async (text: string) => {
    await copyText(text);
  };

  const quickSplitAndCopy = async () => {
    const source = deps.getInputContent();
    if (!source.trim()) {
      store.showToast(t('tools.text_split.empty_input_warning'), { type: 'warning' });
      return;
    }

    const result = splitTextToList(source, { delimiter: ',', defaultDelimiter: ',' });
    updateQuickResult('tools.text_split.quick_split', result.text);

    try {
      await copyToClipboard(result.text);
      store.showToast(t('tools.text_split.processed_and_copied', { count: result.items.length }), { type: 'success' });
    } catch {
      store.showToast(t('tools.text_split.processed_but_copy_failed', { count: result.items.length }), { type: 'warning' });
    }
  };

  const quickJoinAndCopy = async () => {
    const source = deps.getInputContent();
    if (!source.trim()) {
      store.showToast(t('tools.text_join.empty_input_warning'), { type: 'warning' });
      return;
    }

    const result = joinTextLines(source, {
      delimiter: ',',
      defaultDelimiter: ',',
      prefix: quickJoinPrefix.value,
      enableQuote: false,
      quoteChar: '"',
    });
    updateQuickResult('tools.text_join.quick_merge', result.text);

    try {
      await copyToClipboard(result.text);
      store.showToast(t('tools.text_join.processed_and_copied', { count: result.items.length }), {
        type: 'success',
        durationMs: 2400,
      });
    } catch {
      store.showToast(t('tools.text_join.processed_but_copy_failed', { count: result.items.length }), { type: 'warning' });
    }
  };

  const quickDedupAndCopy = async () => {
    const source = deps.getInputContent();
    if (!source.trim()) {
      store.showToast(t('tools.text_dedup.empty_input_warning'), { type: 'warning' });
      return;
    }

    const result = dedupLines(source, {
      trimLine: true,
      ignoreCase: false,
      removeEmpty: true,
      sortOutput: false,
      keepOrder: true,
    });
    const output = result.items.join('\n');
    updateQuickResult('tools.text_dedup.quick_dedup', output);

    try {
      await copyToClipboard(output);
      store.showToast(t('tools.text_dedup.processed_and_copied', { total: result.total, removed: result.removed, unique: result.items.length }), {
        type: 'success',
      });
    } catch {
      store.showToast(t('tools.text_dedup.processed_but_copy_failed', { total: result.total, removed: result.removed, unique: result.items.length }), {
        type: 'warning',
      });
    }
  };

  const quickRemoveEscapeAndCopy = async () => {
    const source = deps.getInputContent();
    if (!source.trim()) {
      store.showToast(t('tools.text_processor.empty_input_warning'), { type: 'warning' });
      return;
    }

    try {
      const result = processText(source, 'remove_escape');
      updateQuickResult('tools.text_processor.quick_remove_escape', result);
      await copyToClipboard(result);
      store.showToast(t('tools.text_processor.processed_and_copied'), { type: 'success' });
    } catch (e) {
      store.showToast(t('tools.text_processor.process_failed', { reason: (e as { message?: string } | null)?.message }), { type: 'error' });
    }
  };

  const quickUrlDecodeAndCopy = async () => {
    const source = deps.getInputContent();
    if (!source.trim()) {
      store.showToast(t('tools.text_processor.empty_input_warning'), { type: 'warning' });
      return;
    }

    try {
      const result = processText(source, 'url_decode');
      updateQuickResult('tools.text_processor.quick_url_decode', result);
      await copyToClipboard(result);
      store.showToast(t('tools.text_processor.processed_and_copied'), { type: 'success' });
    } catch (e) {
      store.showToast(t('tools.text_processor.process_failed', { reason: (e as { message?: string } | null)?.message }), { type: 'error' });
    }
  };

  const quickActions = computed(() => [
    { key: 'tools.text_split.quick_split', execute: quickSplitAndCopy, icon: quickActionIcons[0] },
    { key: 'tools.text_join.quick_merge', execute: quickJoinAndCopy, icon: quickActionIcons[1] },
    { key: 'tools.text_dedup.quick_dedup', execute: quickDedupAndCopy, icon: quickActionIcons[2] },
    { key: 'tools.text_processor.quick_remove_escape', execute: quickRemoveEscapeAndCopy, icon: quickActionIcons[3] },
    { key: 'tools.text_processor.quick_url_decode', execute: quickUrlDecodeAndCopy, icon: quickActionIcons[4] },
  ]);

  return {
    quickResult,
    quickJoinPrefix,
    activeQuickActionKey,
    hasActivatedQuickWorkbench,
    quickActions,
    quickSplitAndCopy,
    quickJoinAndCopy,
    quickDedupAndCopy,
    quickRemoveEscapeAndCopy,
    quickUrlDecodeAndCopy,
  };
}
