<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { useAppStore } from '@/store/app';
import {
  decodeBase32,
  generateTotp,
  normalizeBase32Secret,
  parseOtpAuthUri,
  verifyTotpCode,
  type TotpAlgorithm,
} from './engine';

interface Props {
  initialData?: string;
}

type StatusTone = 'neutral' | 'success' | 'warning' | 'error';

const props = defineProps<Props>();
const store = useAppStore();
const { t } = useI18n();

const secretInput = ref('');
const uriInput = ref('');
const algorithm = ref<TotpAlgorithm>('SHA1');
const digits = ref(6);
const period = ref(30);
const issuer = ref('');
const account = ref('');
const currentCode = ref('');
const remainingSeconds = ref(0);
const statusMessage = ref('');
const statusTone = ref<StatusTone>('neutral');
const verifyInput = ref('');
const verifyResult = ref('');
const verifyTone = ref<StatusTone>('neutral');
const secretError = ref('');

let timer: ReturnType<typeof setInterval> | null = null;

const toneClassMap: Record<StatusTone, string> = {
  neutral:
    'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
  success:
    'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning:
    'border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-100',
  error:
    'border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-100',
};

const progressPercent = computed(() => {
  if (period.value <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (remainingSeconds.value / period.value) * 100));
});

const setStatus = (message: string, tone: StatusTone) => {
  statusMessage.value = message;
  statusTone.value = tone;
};

const resolveSecretBytes = () => {
  const raw = secretInput.value.trim();
  if (!raw) {
    throw new Error(t('tools.totp_2fa.secret_invalid'));
  }
  return decodeBase32(raw);
};

const refreshCode = async () => {
  try {
    const secret = resolveSecretBytes();
    const result = await generateTotp({
      secret,
      period: period.value,
      digits: digits.value,
      algorithm: algorithm.value,
    });
    currentCode.value = result.code;
    remainingSeconds.value = result.remainingSeconds;
    secretError.value = '';
    if (statusTone.value === 'error' || !statusMessage.value) {
      setStatus(t('tools.totp_2fa.status_ready'), 'success');
    }
  } catch (error) {
    currentCode.value = '';
    remainingSeconds.value = 0;
    const message =
      error instanceof Error ? error.message : t('tools.totp_2fa.status_error');
    secretError.value = message;
    setStatus(message, 'error');
  }
};

const applyInitialPayload = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    uriInput.value = trimmed;
    try {
      applyParsedUri(trimmed);
    } catch {
      // keep as secret fallback if URI broken
      secretInput.value = trimmed;
    }
    return;
  }

  secretInput.value = normalizeBase32Secret(trimmed) || trimmed;
};

const applyParsedUri = (uri: string) => {
  const parsed = parseOtpAuthUri(uri);
  secretInput.value = parsed.secret;
  algorithm.value = parsed.algorithm;
  digits.value = parsed.digits;
  period.value = parsed.period;
  issuer.value = parsed.issuer;
  account.value = parsed.account;
  setStatus(t('tools.totp_2fa.uri_parsed'), 'success');
};

const handleParseUri = async () => {
  try {
    applyParsedUri(uriInput.value);
    await refreshCode();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('tools.totp_2fa.uri_invalid');
    setStatus(message, 'error');
    store.showToast(message, { type: 'error' });
  }
};

const copyCode = async () => {
  if (!currentCode.value) {
    store.showToast(t('tools.totp_2fa.empty_code'), { type: 'warning' });
    return;
  }

  const ok = await copyText(currentCode.value);
  store.showToast(
    t(ok ? 'tools.totp_2fa.copy_success' : 'tools.totp_2fa.copy_failed'),
    { type: ok ? 'success' : 'error' },
  );
};

const handleVerify = async () => {
  const code = verifyInput.value.trim();
  if (!code) {
    verifyResult.value = t('tools.totp_2fa.verify_empty');
    verifyTone.value = 'warning';
    return;
  }

  try {
    const secret = resolveSecretBytes();
    const result = await verifyTotpCode({
      secret,
      code,
      period: period.value,
      digits: digits.value,
      algorithm: algorithm.value,
      window: 1,
    });

    if (result.valid) {
      verifyResult.value = t('tools.totp_2fa.verify_match', {
        delta: result.matchedDelta ?? 0,
      });
      verifyTone.value = 'success';
    } else {
      verifyResult.value = t('tools.totp_2fa.verify_mismatch');
      verifyTone.value = 'error';
    }
  } catch (error) {
    verifyResult.value =
      error instanceof Error ? error.message : t('tools.totp_2fa.secret_invalid');
    verifyTone.value = 'error';
  }
};

const handleClear = () => {
  secretInput.value = '';
  uriInput.value = '';
  algorithm.value = 'SHA1';
  digits.value = 6;
  period.value = 30;
  issuer.value = '';
  account.value = '';
  currentCode.value = '';
  remainingSeconds.value = 0;
  verifyInput.value = '';
  verifyResult.value = '';
  verifyTone.value = 'neutral';
  secretError.value = '';
  setStatus(t('tools.totp_2fa.status_idle'), 'neutral');
};

// When secret field itself is an otpauth URI, parse on blur/change
watch(secretInput, async (value) => {
  const trimmed = value.trim();
  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      applyParsedUri(trimmed);
      uriInput.value = trimmed;
    } catch {
      // leave raw; refreshCode will surface error
    }
  }
  await refreshCode();
});

watch([algorithm, digits, period], async () => {
  await refreshCode();
});

onMounted(() => {
  setStatus(t('tools.totp_2fa.status_idle'), 'neutral');
  if (props.initialData?.trim()) {
    applyInitialPayload(props.initialData);
  }
  void refreshCode();
  timer = setInterval(() => {
    void refreshCode();
  }, 1000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});

watch(
  () => props.initialData,
  (value) => {
    if (value?.trim()) {
      applyInitialPayload(value);
      void refreshCode();
    }
  },
);
</script>

<template>
  <div class="h-full overflow-auto bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <div class="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div
        class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none"
      >
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-xs uppercase tracking-[0.3em] text-cyan-600 dark:text-cyan-300">
              {{ t('tools.totp_2fa.title') }}
            </div>
            <h2 class="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {{ t('tools.totp_2fa.subtitle') }}
            </h2>
          </div>
          <div class="rounded-2xl border px-4 py-3 text-sm" :class="toneClassMap[statusTone]">
            {{ statusMessage }}
          </div>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section
          class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none"
        >
          <div class="space-y-4">
            <label class="block">
              <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ t('tools.totp_2fa.secret_label') }}
              </div>
              <textarea
                v-model="secretInput"
                data-testid="totp-secret-input"
                rows="3"
                class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                :placeholder="t('tools.totp_2fa.secret_placeholder')"
              />
              <div v-if="secretError" class="mt-2 text-xs text-rose-600 dark:text-rose-300">
                {{ secretError }}
              </div>
            </label>

            <label class="block">
              <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ t('tools.totp_2fa.uri_label') }}
              </div>
              <textarea
                v-model="uriInput"
                data-testid="totp-uri-input"
                rows="2"
                class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                :placeholder="t('tools.totp_2fa.uri_placeholder')"
              />
            </label>

            <div class="grid gap-3 sm:grid-cols-2">
              <button
                data-testid="totp-parse-uri-btn"
                type="button"
                class="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                @click="handleParseUri"
              >
                {{ t('tools.totp_2fa.parse_uri_btn') }}
              </button>
              <button
                data-testid="totp-clear-btn"
                type="button"
                class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleClear"
              >
                {{ t('tools.totp_2fa.clear_btn') }}
              </button>
            </div>

            <div class="grid gap-4 sm:grid-cols-3">
              <label class="block">
                <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ t('tools.totp_2fa.algorithm_label') }}
                </div>
                <select
                  v-model="algorithm"
                  data-testid="totp-algorithm-select"
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                >
                  <option value="SHA1">SHA1</option>
                  <option value="SHA256">SHA256</option>
                  <option value="SHA512">SHA512</option>
                </select>
              </label>

              <label class="block">
                <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ t('tools.totp_2fa.digits_label') }}
                </div>
                <select
                  v-model.number="digits"
                  data-testid="totp-digits-select"
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                >
                  <option :value="6">6</option>
                  <option :value="7">7</option>
                  <option :value="8">8</option>
                </select>
              </label>

              <label class="block">
                <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ t('tools.totp_2fa.period_label') }}
                </div>
                <input
                  v-model.number="period"
                  data-testid="totp-period-input"
                  type="number"
                  min="1"
                  max="300"
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                />
              </label>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ t('tools.totp_2fa.issuer_label') }}
                </div>
                <input
                  v-model="issuer"
                  data-testid="totp-issuer-input"
                  type="text"
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                />
              </label>
              <label class="block">
                <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ t('tools.totp_2fa.account_label') }}
                </div>
                <input
                  v-model="account"
                  data-testid="totp-account-input"
                  type="text"
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                />
              </label>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-6">
          <div
            class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none"
          >
            <div class="text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ t('tools.totp_2fa.current_code') }}
            </div>
            <div class="mt-1 text-xs text-slate-500 dark:text-slate-500">
              {{ t('tools.totp_2fa.refresh_hint') }}
            </div>

            <div
              data-testid="totp-current-code"
              class="mt-6 text-center font-mono text-5xl font-semibold tracking-[0.35em] text-slate-900 dark:text-white"
            >
              {{ currentCode || '------' }}
            </div>

            <div class="mt-6">
              <div class="mb-2 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                <span data-testid="totp-remaining">
                  {{ t('tools.totp_2fa.remaining', { seconds: remainingSeconds }) }}
                </span>
                <span class="text-xs uppercase tracking-[0.2em]">
                  {{ algorithm }} · {{ digits }} · {{ period }}s
                </span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  data-testid="totp-progress"
                  class="h-full rounded-full bg-cyan-500 transition-all duration-1000 ease-linear"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
            </div>

            <button
              data-testid="totp-copy-btn"
              type="button"
              class="mt-6 w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!currentCode"
              @click="copyCode"
            >
              {{ t('tools.totp_2fa.copy_btn') }}
            </button>
          </div>

          <div
            class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none"
          >
            <div class="text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ t('tools.totp_2fa.verify_label') }}
            </div>
            <div class="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                v-model="verifyInput"
                data-testid="totp-verify-input"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                class="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                :placeholder="t('tools.totp_2fa.verify_placeholder')"
                @keydown.enter="handleVerify"
              />
              <button
                data-testid="totp-verify-btn"
                type="button"
                class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleVerify"
              >
                {{ t('tools.totp_2fa.verify_btn') }}
              </button>
            </div>
            <div
              v-if="verifyResult"
              data-testid="totp-verify-result"
              class="mt-3 rounded-2xl border px-4 py-3 text-sm"
              :class="toneClassMap[verifyTone]"
            >
              {{ verifyResult }}
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.h-full.overflow-auto {
  background: transparent !important;
  color: var(--skin-text-main) !important;
}

.rounded-3xl.border.border-slate-200,
.rounded-3xl.border.border-slate-800 {
  border-color: var(--skin-border) !important;
  background: var(--skin-panel-bg) !important;
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft) !important;
}

.text-cyan-600,
html.dark .text-cyan-300 {
  color: var(--skin-accent) !important;
  text-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.3);
}

.text-slate-950,
html.dark .text-white,
html.dark .text-slate-50 {
  color: var(--skin-text-strong) !important;
}

.text-slate-600,
.text-slate-700,
html.dark .text-slate-200,
html.dark .text-slate-300,
html.dark .text-slate-400 {
  color: var(--skin-text-muted) !important;
}

.text-slate-500 {
  color: var(--skin-text-subtle) !important;
}

.border-slate-200,
.border-slate-300,
html.dark .border-slate-700,
html.dark .border-slate-800 {
  border-color: var(--skin-border) !important;
}

.bg-white,
html.dark .bg-slate-900\/70,
html.dark .bg-slate-950 {
  background: var(--skin-panel-bg) !important;
}

.bg-cyan-500 {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2)) !important;
  color: white !important;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.35) !important;
}

.bg-emerald-500 {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2)) !important;
  color: white !important;
}

.focus\:border-cyan-500:focus {
  border-color: var(--skin-accent) !important;
  box-shadow: 0 0 0 3px rgba(var(--skin-accent-rgb) / 0.12) !important;
}

textarea,
input,
select {
  background: var(--skin-panel-bg) !important;
  color: var(--skin-text-strong) !important;
  border-color: var(--skin-border) !important;
}

textarea::placeholder,
input::placeholder {
  color: var(--skin-text-subtle) !important;
}
</style>
