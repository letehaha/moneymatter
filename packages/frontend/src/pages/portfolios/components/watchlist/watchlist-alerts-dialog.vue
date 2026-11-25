<script setup lang="ts">
import {
  type CreateWatchlistAlertBody,
  type UpdateWatchlistAlertBody,
  createWatchlistAlert,
  deleteWatchlistAlert,
  updateWatchlistAlert,
} from '@/api/watchlist';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalNumber } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import {
  WATCHLIST_ALERT_FREQUENCIES,
  WATCHLIST_ALERT_TYPES,
  WATCHLIST_LIMITS,
  type WatchlistAlertFrequency,
  type WatchlistAlertModel,
  type WatchlistItemModel,
} from '@bt/shared/types';
import { PencilIcon, Trash2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useFormatWatchlistPrice, useWatchlistMutation } from './use-watchlist';
import { isPriceInputInvalid, priceInputToDecimal } from './watchlist-helpers';

const props = defineProps<{ portfolioId: string; item: WatchlistItemModel | null }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { format: formatDate } = useDateLocale();
const formatWatchlistPrice = useFormatWatchlistPrice();

type AlertKind = 'price' | 'move';
type Direction = typeof WATCHLIST_ALERT_TYPES.closeAbove | typeof WATCHLIST_ALERT_TYPES.closeBelow;

const editingId = ref<string | null>(null);
const kind = ref<AlertKind>('price');
const direction = ref<{ value: Direction; label: string } | null>(null);
const price = ref<string | number | null>(null);
const percent = ref<string | number | null>(null);
const frequency = ref<WatchlistAlertFrequency>(WATCHLIST_ALERT_FREQUENCIES.once);
const notifyInApp = ref(true);
const notifyEmail = ref(false);
const alertToDelete = ref<WatchlistAlertModel | null>(null);
const isDeleteOpen = ref(false);

const kindItems = computed(() => [
  { value: 'price', label: t('portfolioDetail.watchlist.alerts.kindPrice') },
  { value: 'move', label: t('portfolioDetail.watchlist.alerts.kindMove') },
]);
const directionOptions = computed<{ value: Direction; label: string }[]>(() => [
  { value: WATCHLIST_ALERT_TYPES.closeAbove, label: t('portfolioDetail.watchlist.alerts.above') },
  { value: WATCHLIST_ALERT_TYPES.closeBelow, label: t('portfolioDetail.watchlist.alerts.below') },
]);
const frequencyOptions = computed(() => [
  {
    value: WATCHLIST_ALERT_FREQUENCIES.once,
    title: t('portfolioDetail.watchlist.alerts.once'),
    hint: t('portfolioDetail.watchlist.alerts.onceHint'),
  },
  {
    value: WATCHLIST_ALERT_FREQUENCIES.everyTime,
    title: t('portfolioDetail.watchlist.alerts.everyTime'),
    hint: t('portfolioDetail.watchlist.alerts.everyTimeHint'),
  },
]);

const resetForm = () => {
  editingId.value = null;
  kind.value = 'price';
  direction.value = directionOptions.value[1] ?? null;
  price.value = props.item?.targetPrice ? Number(props.item.targetPrice) : null;
  percent.value = null;
  frequency.value = WATCHLIST_ALERT_FREQUENCIES.once;
  notifyInApp.value = true;
  notifyEmail.value = false;
};

watch(isOpen, (open) => {
  if (open) resetForm();
});

const startEdit = (alert: WatchlistAlertModel) => {
  editingId.value = alert.id;
  kind.value = alert.type === WATCHLIST_ALERT_TYPES.dailyMove ? 'move' : 'price';
  direction.value = directionOptions.value.find((option) => option.value === alert.type) ?? null;
  price.value = alert.price === null ? null : Number(alert.price);
  percent.value = alert.percent;
  frequency.value = alert.frequency;
  notifyInApp.value = alert.notifyInApp;
  notifyEmail.value = alert.notifyEmail;
};

const currencyCode = computed(() => props.item?.security.currencyCode ?? '');
const formatPrice = ({ value }: { value: string | null }) =>
  formatWatchlistPrice({ value, currencyCode: currencyCode.value });
const formatPercentValue = ({ value }: { value: number }) => toLocalNumber(value, { minimumFractionDigits: 0 });

const lastCloseText = computed(() => {
  const item = props.item;
  if (!item?.lastClose) return '';
  const closePrice = formatPrice({ value: item.lastClose });
  return item.lastCloseDate
    ? t('portfolioDetail.watchlist.alerts.lastClose', {
        price: closePrice,
        date: formatDate(parseISO(item.lastCloseDate), 'MMM d'),
      })
    : t('portfolioDetail.watchlist.alerts.lastCloseUndated', { price: closePrice });
});

const describe = (alert: WatchlistAlertModel) => {
  if (alert.type === WATCHLIST_ALERT_TYPES.dailyMove) {
    return t('portfolioDetail.watchlist.alerts.describeMove', {
      percent: formatPercentValue({ value: alert.percent }),
    });
  }
  const key =
    alert.type === WATCHLIST_ALERT_TYPES.closeAbove
      ? 'portfolioDetail.watchlist.alerts.describeAbove'
      : 'portfolioDetail.watchlist.alerts.describeBelow';
  return t(key, { price: formatPrice({ value: alert.price }) });
};

const details = (alert: WatchlistAlertModel) => {
  const channels = [
    alert.notifyInApp && t('portfolioDetail.watchlist.alerts.channelInApp'),
    alert.notifyEmail && t('portfolioDetail.watchlist.alerts.channelEmail'),
  ].filter(Boolean);
  return [
    alert.frequency === WATCHLIST_ALERT_FREQUENCIES.once
      ? t('portfolioDetail.watchlist.alerts.once')
      : t('portfolioDetail.watchlist.alerts.everyTime'),
    channels.join(' + '),
    alert.lastTriggeredAt &&
      t('portfolioDetail.watchlist.alerts.lastFired', { date: formatDate(alert.lastTriggeredAt, 'MMM d') }),
  ]
    .filter(Boolean)
    .join(' · ');
};

const percentValue = computed(() => {
  const value = Number(percent.value);
  return percent.value !== null &&
    percent.value !== '' &&
    value >= WATCHLIST_LIMITS.movePercent.min &&
    value <= WATCHLIST_LIMITS.movePercent.max
    ? value
    : null;
});
const isPercentOutOfRange = computed(
  () => percent.value !== null && percent.value !== '' && percentValue.value === null,
);
const priceValue = computed(() => priceInputToDecimal({ value: price.value }));
const isPriceInvalid = computed(() => isPriceInputInvalid({ value: price.value }));
const hasChannel = computed(() => notifyInApp.value || notifyEmail.value);
const isAtAlertLimit = computed(
  () => !editingId.value && (props.item?.alerts.length ?? 0) >= WATCHLIST_LIMITS.maxAlertsPerItem,
);
const isFormValid = computed(
  () =>
    hasChannel.value &&
    !isAtAlertLimit.value &&
    (kind.value === 'move' ? percentValue.value !== null : !!priceValue.value && !!direction.value),
);

const createMutation = useWatchlistMutation({
  mutationFn: createWatchlistAlert,
  successKey: 'portfolioDetail.watchlist.alerts.created',
  errorKey: 'portfolioDetail.watchlist.alerts.saveError',
  onSuccess: resetForm,
});
const updateMutation = useWatchlistMutation({
  mutationFn: updateWatchlistAlert,
  successKey: 'portfolioDetail.watchlist.alerts.updated',
  errorKey: 'portfolioDetail.watchlist.alerts.saveError',
});
const toggleMutation = useWatchlistMutation({
  mutationFn: updateWatchlistAlert,
  errorKey: 'portfolioDetail.watchlist.alerts.saveError',
});
const deleteMutation = useWatchlistMutation({
  mutationFn: deleteWatchlistAlert,
  successKey: 'portfolioDetail.watchlist.alerts.deleted',
  errorKey: 'portfolioDetail.watchlist.alerts.deleteError',
  onSuccess: () => {
    isDeleteOpen.value = false;
  },
});

const isSaving = computed(() => createMutation.isPending.value || updateMutation.isPending.value);

const submit = () => {
  if (!props.item || !isFormValid.value || isSaving.value) return;
  const channels = { frequency: frequency.value, notifyInApp: notifyInApp.value, notifyEmail: notifyEmail.value };
  const ids = { portfolioId: props.portfolioId, itemId: props.item.id };

  if (editingId.value) {
    const body: UpdateWatchlistAlertBody =
      kind.value === 'move' ? { ...channels, percent: percentValue.value! } : { ...channels, price: priceValue.value! };
    updateMutation.mutate({ ...ids, alertId: editingId.value, body }, { onSuccess: resetForm });
    return;
  }

  const body: CreateWatchlistAlertBody =
    kind.value === 'move'
      ? { type: WATCHLIST_ALERT_TYPES.dailyMove, percent: percentValue.value!, ...channels }
      : { type: direction.value!.value, price: priceValue.value!, ...channels };
  createMutation.mutate({ ...ids, body });
};

const toggleActive = ({ alert, isActive }: { alert: WatchlistAlertModel; isActive: boolean }) => {
  if (!props.item) return;
  toggleMutation.mutate({
    portfolioId: props.portfolioId,
    itemId: props.item.id,
    alertId: alert.id,
    body: { isActive },
  });
};

const askDelete = (alert: WatchlistAlertModel) => {
  alertToDelete.value = alert;
  isDeleteOpen.value = true;
};
const confirmDelete = () => {
  if (!props.item || !alertToDelete.value) return;
  const alertId = alertToDelete.value.id;
  deleteMutation.mutate(
    { portfolioId: props.portfolioId, itemId: props.item.id, alertId },
    {
      onSuccess: () => {
        if (editingId.value === alertId) resetForm();
      },
    },
  );
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-lg">
    <template #title>
      <span class="flex items-center gap-3">
        <SecurityLogo v-if="item" :security="item.security" class="size-8" />
        {{ $t('portfolioDetail.watchlist.alerts.title', { symbol: item?.security.symbol ?? '' }) }}
      </span>
    </template>
    <template v-if="lastCloseText" #description>{{ lastCloseText }}</template>

    <div v-if="item" class="grid gap-5">
      <section v-if="item.alerts.length" class="grid gap-2">
        <h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {{ $t('portfolioDetail.watchlist.alerts.listTitle') }}
        </h3>
        <div
          v-for="alert in item.alerts"
          :key="alert.id"
          class="border-border flex items-center gap-2 rounded-lg border px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p :class="cn('text-sm font-semibold tabular-nums', !alert.isActive && 'text-muted-foreground')">
              {{ describe(alert) }}
            </p>
            <p class="text-muted-foreground text-xs">{{ details(alert) }}</p>
          </div>
          <Switch
            :model-value="alert.isActive"
            :aria-label="$t('portfolioDetail.watchlist.alerts.toggleLabel')"
            @update:model-value="(value) => toggleActive({ alert, isActive: value })"
          />
          <DesktopOnlyTooltip :content="$t('common.actions.edit')">
            <Button variant="ghost" size="icon-sm" :aria-label="$t('common.actions.edit')" @click="startEdit(alert)">
              <PencilIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
          <DesktopOnlyTooltip :content="$t('common.actions.delete')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :aria-label="$t('common.actions.delete')"
              @click="askDelete(alert)"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </section>

      <form id="watchlist-alert-form" class="@container/alert-form grid gap-4" @submit.prevent="submit">
        <h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {{
            editingId
              ? $t('portfolioDetail.watchlist.alerts.editTitle')
              : $t('portfolioDetail.watchlist.alerts.newTitle')
          }}
        </h3>

        <PillTabs
          :model-value="kind"
          :items="kindItems"
          size="sm"
          :disabled="!!editingId"
          @update:model-value="(value) => (kind = value as AlertKind)"
        />

        <div v-if="kind === 'price'" class="grid grid-cols-1 gap-3 @sm/alert-form:grid-cols-2">
          <SelectField
            v-model="direction"
            :values="directionOptions"
            :disabled="!!editingId"
            :label="$t('portfolioDetail.watchlist.alerts.directionLabel')"
            :placeholder="$t('portfolioDetail.watchlist.alerts.directionPlaceholder')"
          />
          <InputField
            v-model="price"
            type="number"
            step="any"
            only-positive
            :label="$t('portfolioDetail.watchlist.alerts.priceLabel', { currency: currencyCode })"
            :placeholder="$t('portfolioDetail.watchlist.alerts.pricePlaceholder')"
            :error-message="isPriceInvalid ? $t('forms.validators.mustBePositive') : undefined"
          />
        </div>
        <InputField
          v-else
          v-model="percent"
          type="number"
          step="any"
          only-positive
          :label="$t('portfolioDetail.watchlist.alerts.percentLabel')"
          :placeholder="$t('portfolioDetail.watchlist.alerts.percentPlaceholder')"
          :error-message="
            isPercentOutOfRange
              ? $t('portfolioDetail.watchlist.alerts.percentRange', {
                  min: formatPercentValue({ value: WATCHLIST_LIMITS.movePercent.min }),
                  max: formatPercentValue({ value: WATCHLIST_LIMITS.movePercent.max }),
                })
              : undefined
          "
        />

        <RadioGroup
          :model-value="frequency"
          class="grid grid-cols-1 gap-2 @sm/alert-form:grid-cols-2"
          @update:model-value="(value) => (frequency = value as WatchlistAlertFrequency)"
        >
          <label
            v-for="option in frequencyOptions"
            :key="option.value"
            class="border-border has-data-[state=checked]:border-primary flex cursor-pointer items-start gap-2 rounded-lg border p-3"
          >
            <RadioGroupItem :value="option.value" class="mt-0.5" />
            <span>
              <span class="block text-sm font-semibold">{{ option.title }}</span>
              <span class="text-muted-foreground block text-xs">{{ option.hint }}</span>
            </span>
          </label>
        </RadioGroup>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">{{ $t('portfolioDetail.watchlist.alerts.channelsLabel') }}</legend>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox :model-value="notifyInApp" @update:model-value="(value) => (notifyInApp = !!value)" />
              {{ $t('portfolioDetail.watchlist.alerts.channelInApp') }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox :model-value="notifyEmail" @update:model-value="(value) => (notifyEmail = !!value)" />
              {{ $t('portfolioDetail.watchlist.alerts.channelEmail') }}
            </label>
            <label class="text-muted-foreground flex items-center gap-2 text-sm">
              <Checkbox :model-value="false" disabled />
              {{ $t('portfolioDetail.watchlist.alerts.channelPushSoon') }}
            </label>
          </div>
          <p v-if="!hasChannel" class="text-destructive-text text-sm">
            {{ $t('portfolioDetail.watchlist.alerts.channelRequired') }}
          </p>
        </fieldset>

        <p class="text-muted-foreground text-sm">{{ $t('portfolioDetail.watchlist.alerts.checkHint') }}</p>
        <p v-if="isAtAlertLimit" class="text-destructive-text text-sm">
          {{ $t('portfolioDetail.watchlist.limits.alerts', { max: WATCHLIST_LIMITS.maxAlertsPerItem }) }}
        </p>
      </form>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button v-if="editingId" variant="outline" @click="resetForm">{{ $t('common.actions.cancel') }}</Button>
        <Button v-else variant="outline" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
        <Button type="submit" form="watchlist-alert-form" :disabled="!isFormValid || isSaving">
          {{
            editingId
              ? $t('portfolioDetail.watchlist.alerts.saveAlert')
              : $t('portfolioDetail.watchlist.alerts.addAlert')
          }}
        </Button>
      </div>
    </template>

    <ResponsiveAlertDialog
      v-model:open="isDeleteOpen"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      :confirm-disabled="deleteMutation.isPending.value"
      @confirm="confirmDelete"
    >
      <template #title>{{ $t('portfolioDetail.watchlist.alerts.deleteTitle') }}</template>
      <template #description>{{ alertToDelete ? describe(alertToDelete) : '' }}</template>
    </ResponsiveAlertDialog>
  </ResponsiveDialog>
</template>
