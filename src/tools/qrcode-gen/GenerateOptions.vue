<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { BarcodeOptions, GenType, QRCodeOptions } from './runtime';

defineProps<{
  tab: GenType;
}>();

const qrOptions = defineModel<QRCodeOptions>('qrOptions', { required: true });
const barcodeOptions = defineModel<BarcodeOptions>('barcodeOptions', { required: true });

const { t } = useI18n();
</script>

<template>
  <div class="border border-border rounded-md bg-card p-4 flex flex-col gap-4">
    <div class="text-sm font-medium border-b border-border pb-2">{{ t('tools.qrcode_gen.options_title') }}</div>

    <div v-if="tab === 'qrcode'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.error_correction') }}</label>
        <select v-model="qrOptions.errorCorrectionLevel" class="px-2 py-1.5 rounded border border-border bg-background text-sm">
          <option value="L">L (7%)</option>
          <option value="M">M (15%)</option>
          <option value="Q">Q (25%)</option>
          <option value="H">H (30%)</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.margin') }}</label>
        <input v-model.number="qrOptions.margin" type="number" class="px-2 py-1.5 rounded border border-border bg-background text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.width') }}</label>
        <input v-model.number="qrOptions.width" type="number" class="px-2 py-1.5 rounded border border-border bg-background text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.color_dark') }}</label>
        <div class="flex items-center gap-2">
          <input v-model="qrOptions.color.dark" type="color" class="h-8 w-12 cursor-pointer border-0 p-0" />
          <span class="text-xs font-mono">{{ qrOptions.color.dark }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.color_light') }}</label>
        <div class="flex items-center gap-2">
          <input v-model="qrOptions.color.light" type="color" class="h-8 w-12 cursor-pointer border-0 p-0" />
          <span class="text-xs font-mono">{{ qrOptions.color.light }}</span>
        </div>
      </div>
    </div>

    <div v-if="tab === 'barcode'" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.format') }}</label>
        <select v-model="barcodeOptions.format" class="px-2 py-1.5 rounded border border-border bg-background text-sm">
          <option value="CODE128">CODE128 (Default)</option>
          <option value="EAN13">EAN13</option>
          <option value="UPC">UPC</option>
          <option value="EAN8">EAN8</option>
          <option value="ITF14">ITF14</option>
          <option value="MSI">MSI</option>
          <option value="pharmacode">Pharmacode</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.bar_width') }}</label>
        <input v-model.number="barcodeOptions.width" type="number" class="px-2 py-1.5 rounded border border-border bg-background text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.height') }}</label>
        <input v-model.number="barcodeOptions.height" type="number" class="px-2 py-1.5 rounded border border-border bg-background text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.margin') }}</label>
        <input v-model.number="barcodeOptions.margin" type="number" class="px-2 py-1.5 rounded border border-border bg-background text-sm" />
      </div>
      <div class="flex items-center gap-2 mt-4">
        <input v-model="barcodeOptions.displayValue" type="checkbox" class="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary" />
        <label class="text-sm">{{ t('tools.qrcode_gen.display_value') }}</label>
      </div>
    </div>
  </div>
</template>
