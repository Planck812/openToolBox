/**
 * 环境变量设置工具核心操作（拆分自 EnvSetter.vue）。
 * 变量列表/读取/写入预览/应用/删除，依赖注入 27 项。
 */
import { nextTick, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { askConfirm } from '@/lib/confirm';
import { isValidEnvKey, parseEnvAssignment } from '@/tools/env-setter/env-model';
import {
  apply_env_write,
  get_env_platform_info,
  get_user_env_var,
  list_user_env_vars,
  preview_env_delete,
  preview_env_write,
  type EnvPlatformInfo,
  type EnvVariableScope,
  type EnvWritePreview,
  type EnvVariable,
} from '@/tools/env-setter/env-shell';
import { getErrorInfo, hasSameKeyForPlatform } from '@/tools/env-setter/helpers';

export interface EnvVarsDeps {
  keyInput: Ref<string>;
  valueInput: Ref<string>;
  currentValue: Ref<string | null>;
  currentValueKnown: Ref<boolean>;
  selectedScope: Ref<EnvVariableScope | null>;
  selectedVariableKey: Ref<string>;
  loading: Ref<boolean>;
  reading: Ref<boolean>;
  platformInfo: Ref<EnvPlatformInfo | null>;
  platformLoading: Ref<boolean>;
  platformError: Ref<string | null>;
  listLoading: Ref<boolean>;
  listLoaded: Ref<boolean>;
  listError: Ref<string | null>;
  variables: Ref<EnvVariable[]>;
  selectedTargetIds: Ref<string[]>;
  targetError: Ref<string | null>;
  writePreview: Ref<EnvWritePreview | null>;
  applyingPreview: Ref<boolean>;
  deleting: Ref<boolean>;
  submitButton: Ref<HTMLButtonElement | null>;
  cancelPreviewButton: Ref<HTMLButtonElement | null>;
  hasSupportedPlatform: ComputedRef<boolean>;
  isUnixPlatform: ComputedRef<boolean>;
  selectedUnixTargetIds: ComputedRef<string[]>;
  canDeleteSelectedUserVariable: ComputedRef<boolean>;
  store: ReturnType<typeof useAppStore>;
  nextTick: typeof nextTick;
}

export function useEnvVars(deps: EnvVarsDeps) {
  const { t } = useI18n();
  const {
    keyInput,
    valueInput,
    currentValue,
    currentValueKnown,
    selectedScope,
    selectedVariableKey,
    loading,
    reading,
    platformInfo,
    platformLoading,
    platformError,
    listLoading,
    listLoaded,
    listError,
    variables,
    selectedTargetIds,
    targetError,
    writePreview,
    applyingPreview,
    deleting,
    submitButton,
    cancelPreviewButton,
    hasSupportedPlatform,
    isUnixPlatform,
    selectedUnixTargetIds,
    canDeleteSelectedUserVariable,
    store,
    nextTick: _nextTick,
  } = deps;

  const desktopE2eEnabled = import.meta.env.VITE_DESKTOP_E2E === '1';
  const E2E_CLEANUP_REQUEST_EVENT = 'open-toolbox:desktop-e2e:env-setter-cleanup';
  const E2E_CLEANUP_RESULT_EVENT = 'open-toolbox:desktop-e2e:env-setter-cleanup-result';

  let platformRequestId = 0;
  let listRequestId = 0;
  let readRequestId = 0;
  let previewRequestId = 0;
  let applyRequestId = 0;
  let unmounted = false;
  onBeforeUnmount(() => {
    unmounted = true;
  });

const applyInitialData = (raw?: string) => {
  if (!raw?.trim()) return;
  const parsed = parseEnvAssignment(raw);
  if (parsed.ok) {
    keyInput.value = parsed.key;
    valueInput.value = parsed.value;
    return;
  }
  if (isValidEnvKey(raw.trim())) {
    keyInput.value = raw.trim();
  }
};

const restoreSubmitFocus = () => {
  void nextTick(() => {
    const button = submitButton.value;
    if (!unmounted && button?.isConnected) button.focus();
  });
};

const closePreviewDialog = (restoreFocus = true) => {
  if (!writePreview.value) return;
  writePreview.value = null;
  if (restoreFocus) restoreSubmitFocus();
};

const invalidatePreview = () => {
  // The server has no cancel command. Advancing this generation makes a late
  // response unusable in the UI, while the server credential expires normally.
  previewRequestId += 1;
  loading.value = false;
  closePreviewDialog(false);
};

const loadPlatformInfo = async () => {
  const requestId = ++platformRequestId;
  platformLoading.value = true;
  platformError.value = null;

  try {
    const result = await get_env_platform_info();
    if (unmounted || requestId !== platformRequestId) return;
    if (result.platform !== 'windows' && result.platform !== 'macos' && result.platform !== 'linux') {
      platformInfo.value = null;
      platformError.value = t('tools.env_setter.platform_unsupported');
      return;
    }
    platformInfo.value = result;
    selectedTargetIds.value = [];
  } catch (error) {
    if (unmounted || requestId !== platformRequestId) return;
    platformError.value = getErrorInfo(error).message;
  } finally {
    if (!unmounted && requestId === platformRequestId) {
      platformLoading.value = false;
    }
  }
};

const loadVariables = async (options?: { silent?: boolean }) => {
  const requestId = ++listRequestId;
  listLoading.value = true;
  listError.value = null;
  try {
    const result = await list_user_env_vars();
    if (unmounted || requestId !== listRequestId) return;

    if (!result.ok) {
      listError.value = result.message;
      if (!options?.silent) {
        store.showToast(t('tools.env_setter.list_failed', { reason: result.message }), {
          type: 'error',
        });
      }
      return;
    }

    variables.value = result.variables;
    listLoaded.value = true;
  } catch (error) {
    if (unmounted || requestId !== listRequestId) return;
    const reason = getErrorInfo(error).message;
    listError.value = reason;
    if (!options?.silent) {
      store.showToast(t('tools.env_setter.list_failed', { reason }), { type: 'error' });
    }
  } finally {
    if (!unmounted && requestId === listRequestId) {
      listLoading.value = false;
    }
  }
};

const selectVariable = (variable: EnvVariable) => {
  keyInput.value = variable.key;
  valueInput.value = variable.value;
  currentValue.value = variable.value;
  currentValueKnown.value = true;
  selectedScope.value = variable.scope;
  selectedVariableKey.value = variable.key;
};

const dispatchE2eCleanupResult = (detail: { ok: boolean; exists: boolean }) => {
  window.dispatchEvent(new CustomEvent(E2E_CLEANUP_RESULT_EVENT, { detail }));
};

const clearE2eQuoteTestVariable = async () => {
  if (!desktopE2eEnabled) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ exists: boolean }>('delete_e2e_quote_test_env_var');
    dispatchE2eCleanupResult({ ok: !result.exists, exists: result.exists });
  } catch {
    // The backend only emits generic cleanup errors. Do not propagate registry data to the page.
    dispatchE2eCleanupResult({ ok: false, exists: true });
  }
};

const onE2eCleanupRequest = () => {
  void clearE2eQuoteTestVariable();
};

const onDialogKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !writePreview.value || applyingPreview.value) return;
  event.preventDefault();
  closePreviewDialog();
};

const addWindowListeners = () => {
  window.addEventListener('keydown', onDialogKeydown);
  if (desktopE2eEnabled) {
    window.addEventListener(E2E_CLEANUP_REQUEST_EVENT, onE2eCleanupRequest);
  }
};

const removeWindowListeners = () => {
  window.removeEventListener('keydown', onDialogKeydown);
  if (desktopE2eEnabled) {
    window.removeEventListener(E2E_CLEANUP_REQUEST_EVENT, onE2eCleanupRequest);
  }
};

const onSubmit = async () => {
  if (loading.value || applyingPreview.value) return;

  if (!hasSupportedPlatform.value) {
    const reason = platformError.value ?? t('tools.env_setter.platform_loading');
    store.showToast(t('tools.env_setter.platform_failed', { reason }), {
      type: 'error',
      durationMs: 8000,
    });
    return;
  }

  const key = keyInput.value.trim();
  if (!isValidEnvKey(key)) {
    store.showToast(t('tools.env_setter.invalid_key'), { type: 'warning' });
    return;
  }

  const needsUnixConfirmation = isUnixPlatform.value;
  const targets = needsUnixConfirmation ? selectedUnixTargetIds.value : [];
  if (needsUnixConfirmation && !targets.length) {
    targetError.value = t('tools.env_setter.select_target');
    store.showToast(targetError.value, { type: 'warning' });
    return;
  }

  const requestId = ++previewRequestId;
  loading.value = true;
  targetError.value = null;
  try {
    const preview = await preview_env_write({ key, value: valueInput.value, targets });
    if (unmounted || requestId !== previewRequestId) return;

    if (needsUnixConfirmation) {
      // Unix confirmation is enforced by the UI even if a malformed or future
      // backend response accidentally marks the preview as direct-writeable.
      writePreview.value = preview;
      await nextTick();
      if (!unmounted && requestId === previewRequestId) cancelPreviewButton.value?.focus();
      return;
    }

    if (preview.requiresConfirmation) {
      store.showToast(t('tools.env_setter.set_failed', {
        reason: t('tools.env_setter.windows_confirmation_unexpected'),
      }), {
        type: 'error',
        durationMs: 8000,
      });
      return;
    }

    const result = await apply_env_write(preview.previewId);
    if (unmounted || requestId !== previewRequestId) return;
    if (result.ok) {
      store.showToast(t('tools.env_setter.set_success_with_note', { key }), {
        type: 'success',
        durationMs: 5000,
      });
      // 刷新列表不能被当前值读取失败阻断。
      await Promise.allSettled([
        readCurrentValue({ silent: true }),
        loadVariables({ silent: true }),
      ]);
    } else {
      const reason = result.message?.trim() || t('tools.env_setter.unknown_error');
      store.showToast(t('tools.env_setter.set_failed', { reason }), {
        type: 'error',
        durationMs: 8000,
      });
    }
  } catch (error) {
    if (unmounted || requestId !== previewRequestId) return;
    const reason = getErrorInfo(error).message;
    if (needsUnixConfirmation) {
      targetError.value = reason;
      store.showToast(t('tools.env_setter.target_failed', { reason }), {
        type: 'error',
        durationMs: 8000,
      });
    } else {
      store.showToast(t('tools.env_setter.set_failed', { reason }), {
        type: 'error',
        durationMs: 8000,
      });
    }
  } finally {
    if (!unmounted && requestId === previewRequestId) {
      loading.value = false;
    }
  }
};

const deleteSelectedVariable = async () => {
  if (!canDeleteSelectedUserVariable.value || deleting.value || loading.value || applyingPreview.value) return;
  const key = selectedVariableKey.value;
  if (!(await askConfirm(t('tools.env_setter.delete_confirm', { key })))) return;

  deleting.value = true;
  try {
    const preview = await preview_env_delete(key);
    const result = await apply_env_write(preview.previewId);
    if (result.ok) {
      keyInput.value = '';
      valueInput.value = '';
      currentValue.value = null;
      currentValueKnown.value = false;
      selectedScope.value = null;
      selectedVariableKey.value = '';
      store.showToast(t('tools.env_setter.delete_success', { key }), {
        type: 'success',
        durationMs: 5000,
      });
      await loadVariables({ silent: true });
    } else {
      const reason = result.message?.trim() || t('tools.env_setter.unknown_error');
      store.showToast(t('tools.env_setter.delete_failed', { reason }), {
        type: 'error',
        durationMs: 8000,
      });
    }
  } catch (error) {
    const { code, message } = getErrorInfo(error);
    store.showToast(
      code === 'preview_stale'
        ? t('tools.env_setter.delete_stale')
        : t('tools.env_setter.delete_failed', { reason: message }),
      { type: code === 'preview_stale' ? 'warning' : 'error', durationMs: 8000 },
    );
  } finally {
    deleting.value = false;
  }
};

const confirmPreview = async () => {
  const preview = writePreview.value;
  if (!preview || applyingPreview.value) return;

  const requestId = ++applyRequestId;
  let shouldRestoreFocus = false;
  applyingPreview.value = true;
  try {
    const result = await apply_env_write(preview.previewId);
    if (unmounted || requestId !== applyRequestId) return;

    closePreviewDialog(false);
    shouldRestoreFocus = true;
    if (result.ok) {
      store.showToast(t('tools.env_setter.set_success_unix', { key: keyInput.value.trim() }), {
        type: 'success',
        durationMs: 5000,
      });
      // Unix writes update configuration files, not this process. Do not retain
      // a previously resolved value or re-read it as though it reflected the write.
      currentValueKnown.value = false;
      currentValue.value = null;
      await loadVariables({ silent: true });
    } else {
      const reason = result.message?.trim() || t('tools.env_setter.unknown_error');
      store.showToast(t('tools.env_setter.preview_apply_failed', { reason }), {
        type: 'error',
        durationMs: 8000,
      });
    }
  } catch (error) {
    if (unmounted || requestId !== applyRequestId) return;

    const { code, message } = getErrorInfo(error);
    closePreviewDialog(false);
    shouldRestoreFocus = true;
    if (code === 'preview_stale') {
      store.showToast(t('tools.env_setter.preview_stale'), {
        type: 'warning',
        durationMs: 8000,
      });
    } else {
      // apply consumes the Unix preview credential before validation and write,
      // so a non-stale failure also requires a newly generated preview.
      store.showToast(t('tools.env_setter.preview_apply_failed', { reason: message }), {
        type: 'error',
        durationMs: 8000,
      });
    }
  } finally {
    if (!unmounted && requestId === applyRequestId) {
      applyingPreview.value = false;
      if (shouldRestoreFocus) restoreSubmitFocus();
    }
  }
};

const readCurrentValue = async (options?: { silent?: boolean }) => {
  const key = keyInput.value.trim();
  if (!isValidEnvKey(key)) {
    if (!options?.silent) {
      store.showToast(t('tools.env_setter.invalid_key'), { type: 'warning' });
    }
    return;
  }

  const requestId = ++readRequestId;
  // A response is only meaningful under the platform semantics that issued it.
  // In particular, a Unix read must not become case-insensitively current if a
  // delayed platform response later identifies Windows (or vice versa).
  const platformAtRequest = platformInfo.value?.platform;
  const isCurrentRequest = () =>
    !unmounted
    && requestId === readRequestId
    && platformAtRequest !== undefined
    && platformInfo.value?.platform === platformAtRequest
    && hasSameKeyForPlatform(platformAtRequest, keyInput.value.trim(), key);

  reading.value = true;
  try {
    const result = await get_user_env_var(key);
    if (!isCurrentRequest()) return;

    if (!result.ok) {
      currentValueKnown.value = false;
      currentValue.value = null;
      if (!options?.silent) {
        store.showToast(t('tools.env_setter.read_failed', { reason: result.message }), {
          type: 'error',
        });
      }
      return;
    }

    currentValueKnown.value = true;
    currentValue.value = result.value;
    if (!options?.silent) {
      if (result.value === null) {
        store.showToast(t('tools.env_setter.read_missing', { key }), { type: 'info' });
      } else {
        store.showToast(t('tools.env_setter.read_success', { key }), { type: 'success' });
      }
    }
  } catch (error) {
    if (!isCurrentRequest()) return;
    currentValueKnown.value = false;
    currentValue.value = null;
    if (!options?.silent) {
      const reason = getErrorInfo(error).message;
      store.showToast(t('tools.env_setter.read_failed', { reason }), { type: 'error' });
    }
  } finally {
    if (!unmounted && requestId === readRequestId) {
      reading.value = false;
    }
  }
};

  return {
    applyInitialData,
    loadPlatformInfo,
    loadVariables,
    selectVariable,
    onSubmit,
    deleteSelectedVariable,
    confirmPreview,
    readCurrentValue,
    closePreviewDialog,
    invalidatePreview,
    restoreSubmitFocus,
    addWindowListeners,
    removeWindowListeners,
  };
}
