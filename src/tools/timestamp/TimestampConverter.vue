<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import dayjs from 'dayjs';
import { Copy, Check, ArrowRightLeft } from 'lucide-vue-next';
import { useClipboard } from '@vueuse/core';

const props = defineProps<{
  initialData?: string;
}>();

const { t } = useI18n();
const { copy, copied } = useClipboard();

const input = ref('');
const resultTimestamp = ref('');
const resultDate = ref('');
// const mode = ref<'auto' | 'to_date' | 'to_timestamp'>('auto');

const convert = () => {
  const val = input.value.trim();
  if (!val) {
    resultTimestamp.value = '';
    resultDate.value = '';
    return;
  }

  // Try to parse as timestamp
  let date: dayjs.Dayjs;
  
  if (/^\d{10}$/.test(val)) {
    date = dayjs.unix(parseInt(val));
  } else if (/^\d{13}$/.test(val)) {
    date = dayjs(parseInt(val));
  } else {
    // Try to parse as date string
    date = dayjs(val);
  }

  if (date.isValid()) {
    resultDate.value = date.format('YYYY-MM-DD HH:mm:ss');
    resultTimestamp.value = date.valueOf().toString();
  } else {
    resultDate.value = t('tools.timestamp.invalid');
    resultTimestamp.value = '';
  }
};

watch(input, convert);

onMounted(() => {
  if (props.initialData) {
    input.value = props.initialData;
    convert();
  } else {
    // Default to current time
    input.value = dayjs().valueOf().toString();
    convert();
  }
});

const setNow = () => {
  input.value = dayjs().valueOf().toString();
};
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-6 max-w-2xl mx-auto">
    <!-- Input Section -->
    <div class="flex flex-col gap-2">
      <div class="flex justify-between items-center">
        <label class="text-sm font-medium text-muted-foreground">{{ t('common.input') }}</label>
        <button data-testid="timestamp-now-button" class="text-xs text-primary hover:underline" @click="setNow">
          {{ t('tools.timestamp.now') }}
        </button>
      </div>
      <input
        v-model="input"
        data-testid="timestamp-input"
        class="w-full p-3 rounded-md border bg-background font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary"
        :placeholder="t('tools.timestamp.placeholder')"
      />
    </div>

    <div class="flex justify-center text-muted-foreground">
      <ArrowRightLeft class="w-6 h-6 rotate-90" />
    </div>

    <!-- Results -->
    <div class="grid grid-cols-1 gap-4">
      <!-- Date Result -->
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-muted-foreground">Date</label>
        <div class="flex gap-2">
          <div data-testid="timestamp-date-result" class="flex-1 p-3 rounded-md border bg-muted/30 font-mono text-lg">
            {{ resultDate }}
          </div>
          <button
            v-if="resultDate && resultDate !== t('tools.timestamp.invalid')"
            class="p-3 rounded-md border hover:bg-muted transition-colors"
            @click="copy(resultDate)"
          >
            <Check v-if="copied" class="w-5 h-5 text-green-500" />
            <Copy v-else class="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <!-- Timestamp Result -->
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-muted-foreground">Timestamp (ms)</label>
        <div class="flex gap-2">
          <div data-testid="timestamp-ms-result" class="flex-1 p-3 rounded-md border bg-muted/30 font-mono text-lg">
            {{ resultTimestamp }}
          </div>
          <button
            v-if="resultTimestamp"
            class="p-3 rounded-md border hover:bg-muted transition-colors"
            @click="copy(resultTimestamp)"
          >
            <Check v-if="copied" class="w-5 h-5 text-green-500" />
            <Copy v-else class="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
