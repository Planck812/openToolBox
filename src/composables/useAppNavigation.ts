import { useRouter, useRoute } from 'vue-router';
import type { Window } from '@tauri-apps/api/window';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { loadPipelines } from '@/tools/text-processor/pipeline-store';
import { runPipeline, type StepDeps } from '@/tools/text-processor/steps';
import { digestText } from '@/tools/hash-tool/runtime';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { logToFile } from '@/lib/logger';
import { toastShow } from '@/lib/ipc/toast';

/**
 * 页面导航与管线执行（拆分自 App.vue）。
 * 依赖 ensureWindowActivated（窗口显示/聚焦），保持「唤起 → 导航 → 回填输入」的原子语义。
 */
export function useAppNavigation(deps: {
  ensureWindowActivated: (source: string) => Promise<Window | null>;
}) {
  const router = useRouter();
  const route = useRoute();
  const store = useAppStore();
  const { t } = useI18n();

  /** hash 步骤依赖注入：适配 StepDeps（algorithm 为 string）与 hash-tool 的 HashAlgorithm。 */
  const pipelineDeps: StepDeps = {
    digestText: digestText as (algorithm: string, text: string) => Promise<string>,
  };

  /**
   * 拉起主页：显示窗口、聚焦并跳转到 HomeView
   */
  const openHomeView = async () => {
    try {
      await logToFile('info', 'openHomeView - Starting...');

      const appWindow = await deps.ensureWindowActivated('openHomeView');
      if (!appWindow) return;

      if (route.name !== 'home') {
        await logToFile('info', 'openHomeView - Navigating to home...');
        await router.push('/');
        await logToFile('info', 'openHomeView - ✅ Navigated to home');
      }

      try {
        await logToFile('info', 'openHomeView - Reading clipboard...');
        const text = await readText();
        if (text) {
          await logToFile('info', 'openHomeView - Clipboard text length: ' + text.length);
          store.inputContent = text;
        } else {
          await logToFile('info', 'openHomeView - Clipboard is empty');
        }
      } catch (e) {
        await logToFile('error', 'openHomeView - ❌ Failed to read clipboard', e);
      }

      await logToFile('info', 'openHomeView - ✅ Complete!');
    } catch (e) {
      await logToFile('error', 'openHomeView - ❌ Error:', e);
    }
  };

  /**
   * 拉起指定工具页：显示窗口、聚焦并跳转到 /tool/:id
   * @param toolId 工具 id
   */
  const openToolView = async (toolId: string) => {
    try {
      await logToFile('info', 'openToolView - Starting:', toolId);
      const appWindow = await deps.ensureWindowActivated('openToolView');
      if (!appWindow) return;
      await router.push(`/tool/${toolId}`);
      await logToFile('info', 'openToolView - ✅ Complete:', toolId);
    } catch (e) {
      await logToFile('error', 'openToolView - ❌ Error:', e);
    }
  };

  /**
   * 拉起文本管线：唤起窗口 → 读剪贴板写入 inputContent → 带 ?pipeline=&t= 打开 text-processor，
   * TextProcessor 据此自动加载管线并执行（结果自动复制）。
   * @param target 管线 target（`preset:<op>` 或已存管线名）
   * @param input 可选：调用方已提供输入（如快速唤起小窗传入搜索词）时优先使用，否则读剪贴板
   */
  const openTextPipeline = async (target: string, input?: string) => {
    try {
      await logToFile('info', 'openTextPipeline - Starting:', target);
      const appWindow = await deps.ensureWindowActivated('openTextPipeline');
      if (!appWindow) return;
      if (input !== undefined) {
        store.inputContent = input;
      } else {
        try {
          const text = await readText();
          if (text) store.inputContent = text;
        } catch (e) {
          await logToFile('warn', 'openTextPipeline - read clipboard failed', e);
        }
      }
      const nonce = Date.now();
      await router.push(`/tool/text-processor?pipeline=${encodeURIComponent(target)}&t=${nonce}`);
      await logToFile('info', 'openTextPipeline - ✅ Complete:', target);
    } catch (e) {
      await logToFile('error', 'openTextPipeline - ❌ Error:', e);
    }
  };

  /**
   * 后台执行管线：读输入 → 跑管线 → 写回剪贴板 → 右下角 toast 提示。
   * 供快速唤起浮层点击「我的管线」使用，不进入工具页。
   * @param target 已存管线名
   * @param input 可选：调用方已提供输入（浮层搜索词）时优先，否则读剪贴板
   */
  const runPipelineInBackground = async (target: string, input?: string) => {
    const toast = async (message: string, isError = false) => {
      try {
        await toastShow({ message, isError });
      } catch (e) {
        await logToFile('warn', 'toast_show invoke failed', e);
      }
    };

    try {
      await logToFile('info', 'runPipelineInBackground - Starting:', target);

      let text = input;
      if (!text?.trim()) {
        try {
          text = await readText();
        } catch (e) {
          await logToFile('warn', 'runPipelineInBackground - read clipboard failed', e);
        }
      }
      if (!text?.trim()) {
        await toast(t('common.pipeline_run_empty_input'));
        return;
      }

      const saved = loadPipelines().find((p) => p.name === target);
      if (!saved) {
        await toast(t('tools.text_processor.pipeline_missing', { name: target }), true);
        return;
      }

      const result = await runPipeline(text, saved.steps, pipelineDeps);
      if (!result.text) {
        await toast(t('common.pipeline_run_empty_result'));
        return;
      }

      await writeText(result.text);
      await toast(t('common.pipeline_run_completed', { name: target }));
      await logToFile('info', 'runPipelineInBackground - ✅ Complete:', target);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await logToFile('error', 'runPipelineInBackground - ❌ Error:', error);
      await toast(t('common.pipeline_run_failed', { reason }), true);
    }
  };

  /**
   * 拉起设置页：显示窗口、聚焦并跳转到 SettingsView
   * @param section 可选的目标设置区块 id，作为 query.section 传给设置页（如托盘「设置快捷键」指向快捷键分组）
   */
  const openSettingsView = async (section?: string) => {
    try {
      await logToFile('info', 'openSettingsView - Starting...');

      const appWindow = await deps.ensureWindowActivated('openSettingsView');
      if (!appWindow) return;

      if (section) {
        await logToFile('info', 'openSettingsView - Navigating to settings section', section);
        // 始终 push（带 query）以覆盖「已停留在设置页」时的再定向
        await router.push({ path: '/settings', query: { section } });
        await logToFile('info', 'openSettingsView - ✅ Navigated to settings section');
      } else if (route.name !== 'settings') {
        await logToFile('info', 'openSettingsView - Navigating to settings...');
        await router.push('/settings');
        await logToFile('info', 'openSettingsView - ✅ Navigated to settings');
      }
    } catch (e) {
      await logToFile('error', 'openSettingsView - ❌ Error:', e);
    }
  };

  return {
    openHomeView,
    openToolView,
    openTextPipeline,
    openSettingsView,
    runPipelineInBackground,
  };
}
