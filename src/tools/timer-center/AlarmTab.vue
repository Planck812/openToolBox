<script setup lang="ts">
/**
 * 闹钟 tab：列表 + 新增/编辑/启停/删除。
 *
 * repeatDays 空 = 单次闹钟（触发后自动禁用）；非空 = 每周按所选周几重复。
 */
import { onActivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Bell, BellOff, Edit3, Plus, Save, Trash2 } from 'lucide-vue-next';
import { timerAddAlarm, timerDeleteAlarm, timerGetAlarms, timerUpdateAlarm, type Alarm } from '@/lib/ipc/timer';

const { t } = useI18n();
const store = useAppStore();

/** 一周七天（0=周日 ..=6=周六）。 */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKDAY_LABELS = [
  'tools.timer_center.weekday_sunday',
  'tools.timer_center.weekday_monday',
  'tools.timer_center.weekday_tuesday',
  'tools.timer_center.weekday_wednesday',
  'tools.timer_center.weekday_thursday',
  'tools.timer_center.weekday_friday',
  'tools.timer_center.weekday_saturday',
];

const alarms = ref<Alarm[]>([]);
const loading = ref(true);
const errorMessage = ref('');

/** 表单态。 */
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const formLabel = ref('');
const formHour = ref(8);
const formMinute = ref(0);
const formRepeatDays = ref<number[]>([]);

const loadAlarms = async (showLoading = true) => {
  if (showLoading) loading.value = true;
  errorMessage.value = '';
  try {
    alarms.value = await timerGetAlarms();
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  } finally {
    if (showLoading) loading.value = false;
  }
};

/** 打开新增表单。 */
const openAdd = () => {
  editingId.value = null;
  formLabel.value = '';
  formHour.value = 8;
  formMinute.value = 0;
  formRepeatDays.value = [];
  formVisible.value = true;
};

/** 打开编辑表单。 */
const openEdit = (alarm: Alarm) => {
  editingId.value = alarm.id;
  formLabel.value = alarm.label;
  formHour.value = alarm.hour;
  formMinute.value = alarm.minute;
  formRepeatDays.value = [...alarm.repeatDays];
  formVisible.value = true;
};

const toggleDay = (day: number) => {
  if (formRepeatDays.value.includes(day)) {
    formRepeatDays.value = formRepeatDays.value.filter((d) => d !== day);
  } else {
    formRepeatDays.value = [...formRepeatDays.value, day];
  }
};

const isFormValid = () => {
  const h = Number(formHour.value);
  const m = Number(formMinute.value);
  return Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59;
};

/** 保存（新增或更新）。 */
const saveAlarm = async () => {
  if (!isFormValid()) {
    store.showToast(t('tools.timer_center.alarm_invalid_time'), { type: 'error' });
    return;
  }
  const hour = Number(formHour.value);
  const minute = Number(formMinute.value);
  try {
    if (editingId.value) {
      await timerUpdateAlarm({
        id: editingId.value,
        label: formLabel.value.trim(),
        hour,
        minute,
        repeatDays: formRepeatDays.value,
        enabled: alarms.value.find((a) => a.id === editingId.value)?.enabled ?? true,
      });
    } else {
      await timerAddAlarm({
        label: formLabel.value,
        hour,
        minute,
        repeatDays: formRepeatDays.value,
      });
    }
    formVisible.value = false;
    await loadAlarms(false);
    store.showToast(
      editingId.value
        ? t('tools.timer_center.alarm_updated')
        : t('tools.timer_center.alarm_added'),
      { type: 'success' },
    );
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
    store.showToast(t('tools.timer_center.alarm_save_failed'), { type: 'error' });
  }
};

/** 启停开关。 */
const toggleAlarm = async (alarm: Alarm) => {
  try {
    await timerUpdateAlarm({ ...alarm, enabled: !alarm.enabled });
    await loadAlarms(false);
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

/** 删除。 */
const deleteAlarm = async (id: string) => {
  try {
    await timerDeleteAlarm(id);
    await loadAlarms(false);
    store.showToast(t('tools.timer_center.alarm_deleted'), { type: 'success' });
  } catch (e) {
    errorMessage.value = typeof e === 'string' ? e : String(e);
  }
};

const formatTime = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

onMounted(async () => {
  await loadAlarms();
});

onActivated(() => {
  void loadAlarms(false);
});
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold">{{ t('tools.timer_center.alarm_list_title') }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ t('tools.timer_center.alarm_list_hint') }}
        </p>
      </div>
      <button
        class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        @click="openAdd"
      >
        <Plus class="h-4 w-4" />
        {{ t('tools.timer_center.alarm_add') }}
      </button>
    </div>

    <div v-if="errorMessage" class="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      {{ errorMessage }}
    </div>

    <!-- 新增/编辑表单 -->
    <div v-if="formVisible" class="mb-5 rounded-xl border border-border bg-muted/40 p-4">
      <div class="mb-3 text-sm font-semibold">
        {{ editingId ? t('tools.timer_center.alarm_edit') : t('tools.timer_center.alarm_add') }}
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.alarm_label') }}</span>
          <input
            v-model="formLabel"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            :placeholder="t('tools.timer_center.alarm_label_placeholder')"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.alarm_hour') }}</span>
          <input
            v-model.number="formHour"
            type="number"
            min="0"
            max="23"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.alarm_minute') }}</span>
          <input
            v-model.number="formMinute"
            type="number"
            min="0"
            max="59"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </div>

      <div class="mt-3">
        <span class="mb-1 block text-xs text-muted-foreground">{{ t('tools.timer_center.alarm_repeat') }}</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(label, index) in WEEKDAY_LABELS"
            :key="index"
            type="button"
            class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="formRepeatDays.includes(WEEKDAYS[index])
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'"
            @click="toggleDay(WEEKDAYS[index])"
          >
            {{ t(label) }}
          </button>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('tools.timer_center.alarm_repeat_hint') }}
        </p>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button
          class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          @click="formVisible = false"
        >
          {{ t('tools.timer_center.cancel') }}
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          @click="saveAlarm"
        >
          <Save class="h-4 w-4" />
          {{ t('tools.timer_center.save') }}
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="py-8 text-center text-sm text-muted-foreground">
      {{ t('tools.timer_center.loading') }}
    </div>
    <div v-else-if="alarms.length === 0" class="py-8 text-center text-sm text-muted-foreground">
      {{ t('tools.timer_center.alarm_empty') }}
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="alarm in alarms"
        :key="alarm.id"
        class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
        :class="{ 'opacity-60': !alarm.enabled }"
      >
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Bell v-if="alarm.enabled" class="h-5 w-5" />
          <BellOff v-else class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold tabular-nums">{{ formatTime(alarm.hour, alarm.minute) }}</span>
            <span v-if="alarm.label" class="truncate text-sm font-medium">{{ alarm.label }}</span>
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <template v-if="alarm.repeatDays.length > 0">
              <span v-for="day in alarm.repeatDays" :key="day" class="rounded bg-muted px-1.5 py-0.5">
                {{ t(WEEKDAY_LABELS[day]) }}
              </span>
            </template>
            <span v-else>{{ t('tools.timer_center.alarm_oneshot') }}</span>
            <span v-if="!alarm.enabled" class="rounded bg-muted px-1.5 py-0.5">
              {{ t('tools.timer_center.alarm_disabled') }}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            class="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :title="alarm.enabled ? t('tools.timer_center.disable') : t('tools.timer_center.enable')"
            @click="toggleAlarm(alarm)"
          >
            <BellOff v-if="alarm.enabled" class="h-4 w-4" />
            <Bell v-else class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :title="t('tools.timer_center.edit')"
            @click="openEdit(alarm)"
          >
            <Edit3 class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :title="t('tools.timer_center.delete')"
            @click="deleteAlarm(alarm.id)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
