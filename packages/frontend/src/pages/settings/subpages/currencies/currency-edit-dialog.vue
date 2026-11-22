<template>
  <ResponsiveDialog v-model:open="open" :dismissible="isDismissible" sr-only-header @dismiss-blocked="onDismissBlocked">
    <template #title>{{ header.title }}</template>
    <template #description>{{ header.description }}</template>

    <div class="@container/currencies grid gap-4 pt-2" :data-testid="`currency-dialog-${view}`">
      <div v-if="view === 'overview'" class="flex items-center gap-3 pr-10" aria-hidden="true">
        <div class="bg-muted flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg">
          <CurrencyIcon :code="code" size="size-8" />
        </div>
        <div class="grid min-w-0 gap-1">
          <p class="text-lg leading-tight font-bold break-words">{{ currency.name }}</p>
          <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span class="break-all">{{ code }}</span>
            <StatusBadge v-if="editableCurrency" variant="info">
              {{ $t('settings.currencies.row.customCurrency') }}
            </StatusBadge>
          </div>
        </div>
      </div>

      <div v-else class="grid gap-2 pr-10">
        <Button
          variant="ghost"
          size="xs"
          class="text-muted-foreground -ml-2 max-w-full justify-self-start"
          :aria-label="$t('settings.currencies.dialog.back', { name: currency.name })"
          :disabled="isSourceSaving"
          data-testid="currency-dialog-back"
          @click="goBack"
        >
          <ChevronLeftIcon class="size-4" />
          <span class="truncate">{{ currency.name }}</span>
        </Button>
        <div class="grid gap-1" aria-hidden="true">
          <p class="text-lg leading-tight font-bold">{{ header.title }}</p>
          <p class="text-muted-foreground text-sm">{{ header.description }}</p>
        </div>
      </div>

      <template v-if="view === 'overview'">
        <RateSummary :currency="currency" />

        <template v-if="editableCurrency">
          <SourceSummaryRow :currency="currency" @change="view = 'source'" />
          <RecentRates :currency="currency" @view-all="view = 'history'" />
        </template>
        <IsoRatePanel
          v-else
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          @submit="handleSubmit"
          @trigger-disabled="isFormDisabled = $event"
          @update:dirty="isIsoDirty = $event"
        />

        <Separator class="bg-border/60" />

        <div class="flex flex-wrap items-center justify-between gap-3">
          <Button
            v-if="editableCurrency"
            variant="outline"
            size="sm"
            class="whitespace-nowrap"
            :disabled="isFormDisabled"
            data-testid="edit-custom-currency"
            @click="openCustomEdit"
          >
            <PencilIcon class="size-4" />
            {{ $t('settings.currencies.dialog.footer.editDetails') }}
          </Button>
          <SetBaseCurrency
            v-else
            :currency="currency"
            :is-form-disabled="isFormDisabled"
            @submit="handleSubmit"
            @trigger-disabled="isFormDisabled = $event"
          />
          <DeleteCurrency
            :currency="currency"
            :is-form-disabled="isFormDisabled"
            :accounts-count="accountsCount"
            @submit="handleSubmit"
            @trigger-disabled="isFormDisabled = $event"
          />
        </div>
      </template>

      <RateHistoryView v-else-if="view === 'history'" :currency="currency" />

      <RateSourceView
        v-else
        :currency="currency"
        @saved="leaveSource"
        @cancel="leaveSource"
        @update:dirty="isSourceDirty = $event"
        @update:saving="isSourceSaving = $event"
      />

      <DiscardChangesDialog
        v-model:open="isDiscardOpen"
        :code="code"
        :current-source-text="editableCurrency ? currentSourceText : null"
        @discard="discardChanges"
      />
    </div>
  </ResponsiveDialog>

  <CustomCurrencyDialog
    v-if="editableCurrency"
    v-model:open="isCustomEditOpen"
    :currency="editableCurrency"
    :accounts-count="accountsCount"
  />
</template>

<script setup lang="ts">
import CurrencyIcon from '@/components/common/currency-icon.vue';
import { pickLogoFields } from '@/components/common/logo-selection';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Separator } from '@/components/lib/ui/separator';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { ChevronLeftIcon, PencilIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import DiscardChangesDialog from './currency-dialog/discard-changes-dialog.vue';
import IsoRatePanel from './currency-dialog/iso-rate-panel.vue';
import RateHistoryView from './currency-dialog/rate-history-view.vue';
import RateSourceView from './currency-dialog/rate-source-view.vue';
import RateSummary from './currency-dialog/rate-summary.vue';
import RecentRates from './currency-dialog/recent-rates.vue';
import { describeRateSource, getPegTarget } from './currency-dialog/source-summary';
import SourceSummaryRow from './currency-dialog/source-summary-row.vue';
import DeleteCurrency from './currency-row/delete-currency.vue';
import SetBaseCurrency from './currency-row/set-base-currency.vue';
import CustomCurrencyDialog from './custom-currency-dialog.vue';
import { CurrencyWithExchangeRate, EditableCustomCurrency } from './types';
import { useRefreshAfterCurrencyChange } from './use-refresh-after-currency-change';

type View = 'overview' | 'history' | 'source';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  accountsCount: number;
}>();

const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const refreshAfterChange = useRefreshAfterCurrencyChange();

const view = ref<View>('overview');
const isFormDisabled = ref(false);
const isSourceDirty = ref(false);
const isSourceSaving = ref(false);
const isIsoDirty = ref(false);
const isDiscardOpen = ref(false);
const pendingLeave = ref<'back' | 'close'>('back');
const isCustomEditOpen = ref(false);

const code = computed(() => props.currency.currency?.code ?? '');
const editableCurrency = computed<EditableCustomCurrency | null>(() => {
  const effective = props.currency.currency;
  if (!effective?.isCustom) return null;

  return {
    code: effective.code,
    name: effective.currency,
    symbol: effective.symbol,
    decimals: effective.digits,
    ...pickLogoFields(props.currency),
  };
});

const header = computed(() => {
  const base = 'settings.currencies.dialog';
  if (view.value === 'history') {
    return { title: t(`${base}.history.title`), description: t(`${base}.history.description`) };
  }
  if (view.value === 'source') {
    return {
      title: t(`${base}.sourceView.title`),
      description: t(`${base}.sourceView.now.${props.currency.rateSource}`, {
        target: getPegTarget({ currency: props.currency }),
      }),
    };
  }
  const description = editableCurrency.value
    ? `${code.value} · ${t('settings.currencies.row.customCurrency')}`
    : code.value;
  return { title: props.currency.name, description };
});

const currentSourceText = computed(() => describeRateSource({ currency: props.currency, t }).value);

const isDismissible = computed(
  () =>
    !isFormDisabled.value &&
    !isSourceSaving.value &&
    !isIsoDirty.value &&
    !(view.value === 'source' && isSourceDirty.value),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  view.value = 'overview';
  isSourceDirty.value = false;
  isSourceSaving.value = false;
  isIsoDirty.value = false;
  isDiscardOpen.value = false;
});

const confirmLeave = ({ to }: { to: 'back' | 'close' }) => {
  pendingLeave.value = to;
  isDiscardOpen.value = true;
};

// A running save cannot be discarded: it would still finish and change the source.
const goBack = () => {
  if (isSourceSaving.value) return;
  if (view.value === 'source' && isSourceDirty.value) {
    confirmLeave({ to: 'back' });
    return;
  }
  view.value = 'overview';
};

const onDismissBlocked = () => {
  if (isSourceSaving.value || isFormDisabled.value) return;
  if (isIsoDirty.value || (view.value === 'source' && isSourceDirty.value)) confirmLeave({ to: 'close' });
};

// The source view emits nothing when it unmounts, so its draft state is cleared here.
const leaveSource = () => {
  isSourceDirty.value = false;
  isSourceSaving.value = false;
  view.value = 'overview';
};

// Closing keeps the current view on screen while the dialog animates out; reopening resets it.
const discardChanges = () => {
  if (pendingLeave.value === 'close') open.value = false;
  else leaveSource();
};

const openCustomEdit = () => {
  open.value = false;
  isCustomEditOpen.value = true;
};

// Closing unmounts the child before it can emit `trigger-disabled: false`.
const handleSubmit = () => {
  isFormDisabled.value = false;
  open.value = false;
  void refreshAfterChange();
};
</script>
