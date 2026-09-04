<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { parseImageBase64 } from './image-base64';

interface Props {
  initialData?: string;
}

interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile?: () => File | null;
}

const props = defineProps<Props>();
const { t } = useI18n();

const previewUrl = ref('');
const base64Text = ref('');
const errorMessage = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);
const pasteListenerCapture = true;

/**
 * 读取本地图片文件并转换为 Data URL
 */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });

/**
 * 从剪贴板条目中提取第一张图片
 */
const extractImageFileFromClipboardItems = (
  items: ArrayLike<ClipboardImageItem> | null | undefined,
): File | null => {
  if (!items) {
    return null;
  }

  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile?.();
    if (!file) {
      continue;
    }

    if (file.name) {
      return file;
    }

    return new File([file], 'clipboard-image.png', {
      type: file.type || 'image/png',
    });
  }

  return null;
};

/**
 * 接收图片文件后同步预览与 Base64 文本
 */
const applyImageFile = async (file: File) => {
  if (!file.type.startsWith('image/')) {
    previewUrl.value = '';
    errorMessage.value = t('tools.image_base64.invalid_image');
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    previewUrl.value = dataUrl;
    base64Text.value = dataUrl;
    errorMessage.value = '';
  } catch {
    previewUrl.value = '';
    errorMessage.value = t('tools.image_base64.read_failed');
  }
};

/**
 * 处理图片文件选择，自动生成 Base64 并更新右侧预览
 */
const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';

  if (!file) {
    return;
  }

  await applyImageFile(file);
};

/**
 * 处理全局图片粘贴，自动生成 Base64 并更新右侧预览
 */
const handlePaste = (event: ClipboardEvent) => {
  const file = extractImageFileFromClipboardItems(event.clipboardData?.items);
  if (!file) {
    return;
  }

  event.preventDefault();
  void applyImageFile(file);
};

watch(
  base64Text,
  (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      previewUrl.value = '';
      errorMessage.value = '';
      return;
    }

    const parsed = parseImageBase64(trimmed);
    if (!parsed) {
      previewUrl.value = '';
      errorMessage.value = t('tools.image_base64.invalid_base64');
      return;
    }

    previewUrl.value = parsed.dataUrl;
    errorMessage.value = '';
  },
  { immediate: true },
);

watch(
  () => props.initialData,
  (value) => {
    const initialValue = value?.trim() ?? '';
    if (!initialValue) {
      return;
    }

    base64Text.value = initialValue;
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('paste', handlePaste, pasteListenerCapture);
});

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste, pasteListenerCapture);
});
</script>

<template>
  <div class="h-full overflow-auto bg-background text-foreground">
    <div class="mx-auto flex max-w-7xl flex-col gap-6 overflow-x-auto p-6">
      <div
        data-testid="converter-layout"
        class="grid min-w-[840px] w-max min-w-full items-stretch gap-6"
        style="grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr);"
      >
        <section class="flex min-h-[420px] flex-col rounded-2xl border border-border bg-card p-4">
          <div class="mb-3 text-sm font-medium">{{ t('tools.image_base64.text_title') }}</div>
          <textarea
            v-model="base64Text"
            data-testid="base64-textarea"
            class="min-h-[360px] flex-1 rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm outline-none transition-colors focus:border-primary"
            :placeholder="t('tools.image_base64.input_placeholder')"
          />
        </section>

        <section class="flex min-h-[420px] flex-col rounded-2xl border border-border bg-card p-4">
          <div class="mb-3 text-sm font-medium">{{ t('tools.image_base64.image_title') }}</div>
          <div class="mb-2 text-sm text-muted-foreground">{{ t('tools.image_base64.upload_btn') }}</div>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            class="mb-4 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-primary-foreground"
            @change="handleFileChange"
          >

          <div class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-4">
            <img
              v-if="previewUrl"
              :src="previewUrl"
              alt="preview"
              data-testid="image-preview"
              class="max-h-[360px] max-w-full rounded-lg object-contain"
            >
            <div v-else class="text-sm text-muted-foreground">
              {{ t('tools.image_base64.preview_placeholder') }}
            </div>
          </div>
        </section>
      </div>

      <div v-if="errorMessage" class="text-sm text-destructive">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>
