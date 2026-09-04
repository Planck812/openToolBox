<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { useAppStore } from '@/store/app';
import {
  applyTimeClaimPreset,
  computePublicKeyFingerprint,
  parseJwtToken,
  signJwtToken,
  verifyJwtToken,
  type JwtKeyConfig,
  type ParsedJwtClaimInfo,
  type TimeClaimPreset,
} from './runtime';

interface Props {
  initialData?: string;
}

type KeyType = JwtKeyConfig['keyType'];
type StatusTone = 'neutral' | 'success' | 'warning' | 'error';

const props = defineProps<Props>();
const store = useAppStore();
const { t } = useI18n();

const algorithmOptions = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
const keyTypeOptions: KeyType[] = ['text', 'pem', 'jwk'];

const jwtInput = ref('');
const headerText = ref(`{
  "alg": "HS256",
  "typ": "JWT"
}`);
const payloadText = ref(`{
  "sub": "codex"
}`);
const algorithm = ref('HS256');
const keyType = ref<KeyType>('text');
const keyText = ref('');
const statusMessage = ref('');
const statusTone = ref<StatusTone>('neutral');
const verificationState = ref('');
const parsedToken = ref<ReturnType<typeof parseJwtToken> | null>(null);
const publicKeyFingerprint = ref('');
const isBusy = ref(false);

const toneClassMap: Record<StatusTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
  success: 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning: 'border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-100',
  error: 'border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-100',
};

const claimEntries = computed(() => {
  const claims = parsedToken.value?.claims;
  if (!claims) {
    return [];
  }

  return (['iat', 'nbf', 'exp'] as const)
    .map((name) => {
      const detail = claims[name];
      if (!detail) {
        return null;
      }
      return {
        name,
        detail,
      };
    })
    .filter((item): item is { name: 'iat' | 'nbf' | 'exp'; detail: ParsedJwtClaimInfo } => Boolean(item));
});

const summaryItems = computed(() => {
  if (!parsedToken.value) {
    return [];
  }

  const items = [
    {
      label: t('tools.jwt_tool.summary_algorithm'),
      value: parsedToken.value.algorithm || '-',
    },
    {
      label: t('tools.jwt_tool.summary_signature'),
      value: parsedToken.value.segments.signature ? t('tools.jwt_tool.signature_present') : t('tools.jwt_tool.signature_missing'),
    },
  ];

  if (parsedToken.value.claims.exp) {
    items.push({
      label: t('tools.jwt_tool.summary_exp'),
      value: t(`tools.jwt_tool.claim_status_${parsedToken.value.claims.exp.status}`),
    });
  }

  if (parsedToken.value.claims.nbf) {
    items.push({
      label: t('tools.jwt_tool.summary_nbf'),
      value: t(`tools.jwt_tool.claim_status_${parsedToken.value.claims.nbf.status}`),
    });
  }

  return items;
});

const segmentCards = computed(() => {
  if (!parsedToken.value) {
    return [];
  }

  return [
    {
      id: 'header',
      label: t('tools.jwt_tool.segment_header'),
      value: parsedToken.value.segments.header,
      length: parsedToken.value.segments.header.length,
    },
    {
      id: 'payload',
      label: t('tools.jwt_tool.segment_payload'),
      value: parsedToken.value.segments.payload,
      length: parsedToken.value.segments.payload.length,
    },
    {
      id: 'signature',
      label: t('tools.jwt_tool.segment_signature'),
      value: parsedToken.value.segments.signature,
      length: parsedToken.value.segments.signature.length,
    },
  ];
});

const totalJwtLength = computed(() => {
  if (!parsedToken.value) {
    return 0;
  }

  return [
    parsedToken.value.segments.header,
    parsedToken.value.segments.payload,
    parsedToken.value.segments.signature,
  ].join('.').length;
});

const canGenerateFingerprint = computed(() => keyType.value === 'pem' || keyType.value === 'jwk');
const fingerprintHintKey = computed(() =>
  canGenerateFingerprint.value
    ? 'tools.jwt_tool.fingerprint_empty'
    : 'tools.jwt_tool.fingerprint_text_unsupported',
);

const syncAlgorithmToHeader = (nextAlgorithm: string) => {
  try {
    const parsedHeader = JSON.parse(headerText.value) as Record<string, unknown>;
    const normalizedHeader = {
      ...parsedHeader,
      alg: nextAlgorithm,
    };
    headerText.value = JSON.stringify(normalizedHeader, null, 2);
  } catch {
    // 当 header 仍在编辑中且不是合法 JSON 时，不覆盖用户输入。
  }
};

const setStatus = (message: string, tone: StatusTone) => {
  statusMessage.value = message;
  statusTone.value = tone;
};

const tryParseJwt = (source: string, options?: { silent?: boolean }) => {
  const trimmed = source.trim();
  if (!trimmed) {
    parsedToken.value = null;
    verificationState.value = '';
    setStatus(t('tools.jwt_tool.status_idle'), 'neutral');
    return;
  }

  try {
    const parsed = parseJwtToken(trimmed);
    parsedToken.value = parsed;
    headerText.value = JSON.stringify(parsed.header, null, 2);
    payloadText.value = JSON.stringify(parsed.payload, null, 2);
    algorithm.value = parsed.algorithm || algorithm.value;
    setStatus(t('tools.jwt_tool.parse_success'), 'success');
  } catch (error) {
    parsedToken.value = null;
    verificationState.value = '';
    if (!options?.silent) {
      setStatus(error instanceof Error ? error.message : t('tools.jwt_tool.parse_failed'), 'error');
    }
  }
};

const copyTextValue = async (
  value: string,
  options: {
    emptyMessage: string;
    successMessage: string;
    failedMessage: string;
  },
) => {
  if (!value.trim()) {
    store.showToast(options.emptyMessage, { type: 'warning' });
    return;
  }

  const ok = await copyText(value);
  store.showToast(ok ? options.successMessage : options.failedMessage, { type: ok ? 'success' : 'error' });
};

const handleParse = () => {
  tryParseJwt(jwtInput.value);
};

const handleClear = () => {
  jwtInput.value = '';
  verificationState.value = '';
  publicKeyFingerprint.value = '';
  setStatus(t('tools.jwt_tool.status_idle'), 'neutral');
};

const copyJwt = async () => {
  await copyTextValue(jwtInput.value, {
    emptyMessage: t('tools.jwt_tool.empty_jwt'),
    successMessage: t('tools.jwt_tool.copy_success'),
    failedMessage: t('tools.jwt_tool.copy_failed'),
  });
};

const copyEditorJson = async (kind: 'header' | 'payload') => {
  const isHeader = kind === 'header';
  await copyTextValue(isHeader ? headerText.value : payloadText.value, {
    emptyMessage: t(`tools.jwt_tool.${kind}_empty`),
    successMessage: t(`tools.jwt_tool.${kind}_copy_success`),
    failedMessage: t(`tools.jwt_tool.${kind}_copy_failed`),
  });
};

const copySegment = async (value: string) => {
  await copyTextValue(value, {
    emptyMessage: t('tools.jwt_tool.segment_empty'),
    successMessage: t('tools.jwt_tool.segment_copy_success'),
    failedMessage: t('tools.jwt_tool.segment_copy_failed'),
  });
};

const copyFingerprint = async () => {
  await copyTextValue(publicKeyFingerprint.value, {
    emptyMessage: t('tools.jwt_tool.fingerprint_empty'),
    successMessage: t('tools.jwt_tool.fingerprint_copy_success'),
    failedMessage: t('tools.jwt_tool.fingerprint_copy_failed'),
  });
};

const withBusy = async (action: () => Promise<void>) => {
  if (isBusy.value) {
    return;
  }

  isBusy.value = true;
  try {
    await action();
  } finally {
    isBusy.value = false;
  }
};

const handleSign = async () => {
  await withBusy(async () => {
    try {
      const token = await signJwtToken({
        algorithm: algorithm.value,
        keyType: keyType.value,
        key: keyText.value,
        headerText: headerText.value,
        payloadText: payloadText.value,
      });
      jwtInput.value = token;
      verificationState.value = t('tools.jwt_tool.sign_success');
      tryParseJwt(token);
      store.showToast(t('tools.jwt_tool.sign_success'), { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tools.jwt_tool.sign_failed');
      verificationState.value = message;
      setStatus(message, 'error');
      store.showToast(message, { type: 'error' });
    }
  });
};

const handleVerify = async () => {
  await withBusy(async () => {
    try {
      const result = await verifyJwtToken({
        token: jwtInput.value,
        algorithm: algorithm.value,
        keyType: keyType.value,
        key: keyText.value,
      });
      verificationState.value = t('tools.jwt_tool.verify_success');
      setStatus(t('tools.jwt_tool.verify_success'), 'success');
      parsedToken.value = parseJwtToken(jwtInput.value);
      headerText.value = JSON.stringify(result.protectedHeader, null, 2);
      payloadText.value = JSON.stringify(result.payload, null, 2);
      store.showToast(t('tools.jwt_tool.verify_success'), { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tools.jwt_tool.verify_failed');
      verificationState.value = message;
      setStatus(message, 'error');
      store.showToast(message, { type: 'error' });
    }
  });
};

const handleApplyTimePreset = (preset: TimeClaimPreset) => {
  try {
    payloadText.value = applyTimeClaimPreset(payloadText.value, preset);
    setStatus(t('tools.jwt_tool.claim_preset_applied'), 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : t('tools.jwt_tool.claim_preset_failed');
    setStatus(message, 'error');
    store.showToast(message, { type: 'error' });
  }
};

const handleGenerateFingerprint = async () => {
  await withBusy(async () => {
    try {
      publicKeyFingerprint.value = await computePublicKeyFingerprint({
        keyType: keyType.value,
        key: keyText.value,
      });
      setStatus(t('tools.jwt_tool.fingerprint_ready'), 'success');
      store.showToast(t('tools.jwt_tool.fingerprint_ready'), { type: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('tools.jwt_tool.fingerprint_failed');
      publicKeyFingerprint.value = '';
      setStatus(message, 'error');
      store.showToast(message, { type: 'error' });
    }
  });
};

watch(
  () => props.initialData,
  (value) => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      return;
    }
    jwtInput.value = trimmed;
    tryParseJwt(trimmed, { silent: true });
  },
  { immediate: true },
);

watch(jwtInput, (value) => {
  verificationState.value = '';
  if (!value.trim()) {
    parsedToken.value = null;
    setStatus(t('tools.jwt_tool.status_idle'), 'neutral');
    return;
  }

  tryParseJwt(value, { silent: true });
});

watch(algorithm, (value) => {
  syncAlgorithmToHeader(value);
});

watch([keyType, keyText], () => {
  publicKeyFingerprint.value = '';
});
</script>

<template>
  <div class="h-full overflow-auto bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <div class="mx-auto flex max-w-[1600px] flex-col gap-6 p-6">
      <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-xs uppercase tracking-[0.3em] text-cyan-600 dark:text-cyan-300">{{ t('tools.jwt_tool.title') }}</div>
            <h2 class="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{{ t('tools.jwt_tool.subtitle') }}</h2>
          </div>
          <div class="rounded-2xl border px-4 py-3 text-sm" :class="toneClassMap[statusTone]">
            {{ statusMessage }}
          </div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[1.2fr_1fr_0.9fr]">
        <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <div class="text-lg font-semibold">{{ t('tools.jwt_tool.jwt_input_title') }}</div>
              <div class="mt-1 text-sm text-slate-600 dark:text-slate-400">{{ t('tools.jwt_tool.jwt_input_hint') }}</div>
            </div>
          </div>
          <textarea
            v-model="jwtInput"
            data-testid="jwt-input"
            class="min-h-[360px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
            :placeholder="t('tools.jwt_tool.jwt_placeholder')"
          />

          <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <button data-testid="parse-btn" class="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-400" @click="handleParse">
              {{ t('tools.jwt_tool.parse_btn') }}
            </button>
            <button data-testid="regenerate-btn" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60" @click="handleSign">
              {{ t('tools.jwt_tool.regenerate_btn') }}
            </button>
            <button data-testid="copy-jwt-btn" class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60" @click="copyJwt">
              {{ t('tools.jwt_tool.copy_btn') }}
            </button>
            <button class="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60" @click="handleClear">
              {{ t('tools.jwt_tool.clear_btn') }}
            </button>
          </div>

          <div class="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/80">
            <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.summary_title') }}</div>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div v-for="item in summaryItems" :key="item.label" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80">
                <div class="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-500">{{ item.label }}</div>
                <div class="mt-2 break-all text-sm text-slate-800 dark:text-slate-100">{{ item.value }}</div>
              </div>
              <div v-if="verificationState" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80 sm:col-span-2">
                <div class="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-500">{{ t('tools.jwt_tool.verify_result') }}</div>
                <div class="mt-2 break-all text-sm text-slate-800 dark:text-slate-100">{{ verificationState }}</div>
              </div>
            </div>
          </div>

          <div class="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/80">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.segment_title') }}</div>
                <div class="mt-1 text-xs text-slate-500 dark:text-slate-500">{{ t('tools.jwt_tool.segment_hint') }}</div>
              </div>
              <div class="grid gap-2 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2">
                <div data-testid="jwt-total-length" class="rounded-full border border-slate-200 px-3 py-1.5 dark:border-slate-800">
                  {{ t('tools.jwt_tool.total_length') }}: {{ totalJwtLength }}
                </div>
                <div data-testid="jwt-signature-length" class="rounded-full border border-slate-200 px-3 py-1.5 dark:border-slate-800">
                  {{ t('tools.jwt_tool.signature_length') }}: {{ parsedToken?.segments.signature.length ?? 0 }}
                </div>
              </div>
            </div>

            <div v-if="segmentCards.length" class="mt-4 space-y-3">
              <div
                v-for="segment in segmentCards"
                :key="segment.id"
                class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80"
              >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="flex items-center gap-3">
                    <span class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ segment.label }}</span>
                    <span class="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {{ segment.length }}
                    </span>
                  </div>
                  <button
                    :data-testid="`copy-segment-${segment.id}-btn`"
                    class="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                    @click="copySegment(segment.value)"
                  >
                    {{ t('tools.jwt_tool.copy_segment_btn') }}
                  </button>
                </div>
                <pre
                  :data-testid="`jwt-segment-${segment.id}`"
                  class="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-slate-100 px-4 py-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >{{ segment.value }}</pre>
              </div>
            </div>
            <div v-else class="mt-4 text-sm text-slate-500 dark:text-slate-500">{{ t('tools.jwt_tool.segment_empty') }}</div>
          </div>
        </section>

        <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none">
          <div>
            <div class="text-lg font-semibold">{{ t('tools.jwt_tool.editor_title') }}</div>
            <div class="mt-1 text-sm text-slate-600 dark:text-slate-400">{{ t('tools.jwt_tool.editor_hint') }}</div>
          </div>

          <div class="mt-4 space-y-4">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.header_title') }}</div>
                <button
                  data-testid="copy-header-btn"
                  class="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                  @click="copyEditorJson('header')"
                >
                  {{ t('tools.jwt_tool.copy_header_btn') }}
                </button>
              </div>
              <textarea
                v-model="headerText"
                data-testid="header-text"
                class="min-h-[220px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
              />
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.payload_title') }}</div>
                <button
                  data-testid="copy-payload-btn"
                  class="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                  @click="copyEditorJson('payload')"
                >
                  {{ t('tools.jwt_tool.copy_payload_btn') }}
                </button>
              </div>
              <textarea
                v-model="payloadText"
                data-testid="payload-text"
                class="min-h-[260px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
              />
            </div>
          </div>

          <div class="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/80">
            <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.claim_quick_actions_title') }}</div>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                data-testid="claim-preset-set-iat-now"
                class="rounded-2xl border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleApplyTimePreset('set-iat-now')"
              >
                {{ t('tools.jwt_tool.preset_set_iat_now') }}
              </button>
              <button
                data-testid="claim-preset-set-nbf-now"
                class="rounded-2xl border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleApplyTimePreset('set-nbf-now')"
              >
                {{ t('tools.jwt_tool.preset_set_nbf_now') }}
              </button>
              <button
                data-testid="claim-preset-exp-10m"
                class="rounded-2xl border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleApplyTimePreset('exp-10m')"
              >
                {{ t('tools.jwt_tool.preset_exp_10m') }}
              </button>
              <button
                data-testid="claim-preset-exp-1h"
                class="rounded-2xl border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleApplyTimePreset('exp-1h')"
              >
                {{ t('tools.jwt_tool.preset_exp_1h') }}
              </button>
              <button
                data-testid="claim-preset-exp-24h"
                class="rounded-2xl border border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                @click="handleApplyTimePreset('exp-24h')"
              >
                {{ t('tools.jwt_tool.preset_exp_24h') }}
              </button>
              <button
                data-testid="claim-preset-clear-time-claims"
                class="rounded-2xl border border-rose-500/40 px-3 py-2 text-left text-xs font-medium text-rose-700 transition hover:border-rose-400 hover:bg-rose-50 dark:text-rose-100 dark:hover:bg-rose-500/10"
                @click="handleApplyTimePreset('clear-time-claims')"
              >
                {{ t('tools.jwt_tool.preset_clear_time_claims') }}
              </button>
            </div>
          </div>

          <div class="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/80">
            <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.claims_title') }}</div>
            <div v-if="claimEntries.length" class="mt-3 space-y-3">
              <div v-for="entry in claimEntries" :key="entry.name" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
                <div class="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <span class="font-medium">{{ entry.name }}</span>
                  <span class="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-500">{{ t(`tools.jwt_tool.claim_status_${entry.detail.status}`) }}</span>
                </div>
                <div class="mt-2 text-sm text-slate-600 dark:text-slate-400">{{ entry.detail.iso }}</div>
                <div class="mt-1 text-xs text-slate-500 dark:text-slate-500">Unix: {{ entry.detail.value }}</div>
              </div>
            </div>
            <div v-else class="mt-3 text-sm text-slate-500 dark:text-slate-500">{{ t('tools.jwt_tool.claims_empty') }}</div>
          </div>
        </section>

        <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none">
          <div>
            <div class="text-lg font-semibold">{{ t('tools.jwt_tool.key_title') }}</div>
            <div class="mt-1 text-sm text-slate-600 dark:text-slate-400">{{ t('tools.jwt_tool.key_hint') }}</div>
          </div>

          <div class="mt-4 space-y-4">
            <label class="block">
              <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.algorithm_label') }}</div>
              <select v-model="algorithm" class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400">
                <option v-for="item in algorithmOptions" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>

            <label class="block">
              <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.key_type_label') }}</div>
              <select
                v-model="keyType"
                data-testid="key-type-select"
                class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
              >
                <option v-for="item in keyTypeOptions" :key="item" :value="item">{{ t(`tools.jwt_tool.key_type_${item}`) }}</option>
              </select>
            </label>

            <div>
              <div class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.key_input_label') }}</div>
              <textarea
                v-model="keyText"
                data-testid="key-text"
                class="min-h-[360px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-cyan-400"
                :placeholder="t('tools.jwt_tool.key_placeholder')"
              />
            </div>

            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/80">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ t('tools.jwt_tool.fingerprint_title') }}</div>
                  <div class="mt-1 text-xs text-slate-500 dark:text-slate-500">{{ t('tools.jwt_tool.fingerprint_hint') }}</div>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <button
                    data-testid="fingerprint-btn"
                    class="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                    :disabled="isBusy || !canGenerateFingerprint"
                    @click="handleGenerateFingerprint"
                  >
                    {{ t('tools.jwt_tool.fingerprint_btn') }}
                  </button>
                  <button
                    v-if="publicKeyFingerprint"
                    data-testid="copy-fingerprint-btn"
                    class="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/60"
                    @click="copyFingerprint"
                  >
                    {{ t('tools.jwt_tool.copy_fingerprint_btn') }}
                  </button>
                </div>
              </div>

              <div
                v-if="publicKeyFingerprint"
                data-testid="fingerprint-value"
                class="mt-3 break-all rounded-2xl bg-emerald-50 px-4 py-3 font-mono text-xs text-emerald-700 dark:bg-slate-900/80 dark:text-emerald-200"
              >
                {{ publicKeyFingerprint }}
              </div>
              <div v-else class="mt-3 text-sm text-slate-500 dark:text-slate-500">{{ t(fingerprintHintKey) }}</div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <button data-testid="verify-btn" class="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60" :disabled="isBusy" @click="handleVerify">
                {{ t('tools.jwt_tool.verify_btn') }}
              </button>
              <button data-testid="sign-btn" class="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60" :disabled="isBusy" @click="handleSign">
                {{ t('tools.jwt_tool.sign_btn') }}
              </button>
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

.text-slate-800,
html.dark .text-slate-100 {
  color: var(--skin-text-main) !important;
}

.border-slate-200,
.border-slate-300,
html.dark .border-slate-700,
html.dark .border-slate-800 {
  border-color: var(--skin-border) !important;
}

.bg-white,
.bg-white\/80,
html.dark .bg-slate-900\/70,
html.dark .bg-slate-900\/80,
html.dark .bg-slate-950\/80 {
  background: var(--skin-panel-bg) !important;
}

.bg-slate-50,
html.dark .bg-slate-900\/80,
html.dark .bg-slate-950 {
  background: rgba(var(--skin-accent-rgb) / 0.03) !important;
}

.bg-slate-100,
html.dark .bg-slate-950 {
  background: rgba(var(--skin-accent-rgb) / 0.05) !important;
}

.bg-cyan-500 {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2)) !important;
  color: white !important;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.35) !important;
}

.bg-cyan-500:hover {
  background: linear-gradient(135deg, var(--skin-accent-2), var(--skin-accent)) !important;
  box-shadow: 0 6px 20px rgba(var(--skin-accent-rgb) / 0.45) !important;
}

.bg-sky-500 {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2)) !important;
  color: white !important;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.35) !important;
}

.focus\:border-cyan-500:focus,
.focus\:border-cyan-400:focus {
  border-color: var(--skin-accent) !important;
  box-shadow: 0 0 0 3px rgba(var(--skin-accent-rgb) / 0.12) !important;
}

textarea,
input {
  background: var(--skin-panel-bg) !important;
  color: var(--skin-text-strong) !important;
  border-color: var(--skin-border) !important;
}

textarea::placeholder {
  color: var(--skin-text-subtle) !important;
}
</style>
