<script setup lang="ts">
import DateField from '@/components/fields/date-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { getErrorMessage } from '@/common/utils/error-message';
import { isDecimal } from '@/common/utils/validators';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useCreateVentureEvent, useVentureEvents } from '@/composable/data-queries/venture/events';
import VentureEventCashFlowPicker from '@/components/forms/venture-event-cash-flow-picker.vue';
import {
  type TransactionModel,
  VENTURE_CASH_FLOW_MODE,
  VENTURE_EVENT_TYPE,
  type VentureDealModel,
  type VentureEventModel,
} from '@bt/shared/types';
import { format, isValid } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addNotification } = useNotificationCenter();

interface Emit {
  (e: 'saved', event: VentureEventModel): void;
  (e: 'cancel'): void;
}

const props = defineProps<{
  deal: VentureDealModel;
}>();

const emit = defineEmits<Emit>();

const createMutation = useCreateVentureEvent();
const { data: existingEvents } = useVentureEvents(() => props.deal.id);
const amountDecimals = computed(() => getCurrencyDecimals({ code: props.deal.currencyCode }));

const hasInitialInvestment = computed(() =>
  (existingEvents.value ?? []).some((e) => e.type === VENTURE_EVENT_TYPE.initial_investment),
);

const availableEventTypes = computed(() => {
  if (!hasInitialInvestment.value) return [VENTURE_EVENT_TYPE.initial_investment];
  return Object.values(VENTURE_EVENT_TYPE).filter((evType) => evType !== VENTURE_EVENT_TYPE.initial_investment);
});

watch(hasInitialInvestment, (has) => {
  if (has && form.type === VENTURE_EVENT_TYPE.initial_investment) {
    form.type = VENTURE_EVENT_TYPE.distribution;
  }
});

const form = reactive({
  type: (hasInitialInvestment.value
    ? VENTURE_EVENT_TYPE.distribution
    : VENTURE_EVENT_TYPE.initial_investment) as VENTURE_EVENT_TYPE,
  eventDate: new Date(),
  grossAmount: '',
  navAfter: '',
  cashFlowMode: VENTURE_CASH_FLOW_MODE.out_of_wallet as VENTURE_CASH_FLOW_MODE,
  notes: '',
  overrideCarry: false,
  gpCarryOverride: '',
  lpNetAmountOverride: '',
});

const selectedTransactions = ref<TransactionModel[]>([]);

const isCarryBearing = computed(
  () => form.type === VENTURE_EVENT_TYPE.distribution || form.type === VENTURE_EVENT_TYPE.exit,
);
const isNavOnly = computed(
  () => form.type === VENTURE_EVENT_TYPE.nav_update || form.type === VENTURE_EVENT_TYPE.writedown,
);
const requiresGross = computed(() => form.type !== VENTURE_EVENT_TYPE.initial_investment && !isNavOnly.value);
const requiresNav = computed(
  () =>
    form.type === VENTURE_EVENT_TYPE.nav_update ||
    form.type === VENTURE_EVENT_TYPE.writedown ||
    form.type === VENTURE_EVENT_TYPE.exit,
);

const toStr = (val: unknown): string => (val == null ? '' : String(val).trim());

const isFormValid = computed(() => {
  if (!isValid(form.eventDate)) return false;
  if (requiresGross.value && !isDecimal(form.grossAmount)) return false;
  if (requiresNav.value && !isDecimal(form.navAfter)) return false;
  if (form.cashFlowMode === VENTURE_CASH_FLOW_MODE.linked && selectedTransactions.value.length === 0) return false;
  if (isNavOnly.value && form.cashFlowMode !== VENTURE_CASH_FLOW_MODE.none) return false;
  if (!isNavOnly.value && form.cashFlowMode === VENTURE_CASH_FLOW_MODE.none) return false;
  if (form.overrideCarry) {
    if (!isDecimal(form.gpCarryOverride)) return false;
    if (!isDecimal(form.lpNetAmountOverride)) return false;
  }
  return true;
});

const isPending = computed(() => createMutation.isPending.value);

const onSubmit = async () => {
  if (!isFormValid.value) return;

  const transactionIds =
    form.cashFlowMode === VENTURE_CASH_FLOW_MODE.linked ? selectedTransactions.value.map((tx) => tx.id) : undefined;

  try {
    const saved = await createMutation.mutateAsync({
      dealId: props.deal.id,
      payload: {
        type: form.type,
        eventDate: format(form.eventDate, 'yyyy-MM-dd'),
        cashFlowMode: form.cashFlowMode,
        grossAmount: requiresGross.value ? toStr(form.grossAmount) : null,
        navAfter: requiresNav.value ? toStr(form.navAfter) : null,
        transactionIds,
        notes: toStr(form.notes) || null,
        gpCarryOverride: form.overrideCarry && isCarryBearing.value ? toStr(form.gpCarryOverride) : null,
        lpNetAmountOverride: form.overrideCarry && isCarryBearing.value ? toStr(form.lpNetAmountOverride) : null,
      },
    });
    addNotification({
      text: t('venture.events.notifications.created'),
      type: NotificationType.success,
    });
    emit('saved', saved);
  } catch (err) {
    addNotification({
      text: getErrorMessage(err, t('venture.events.notifications.error')),
      type: NotificationType.error,
    });
  }
};

const eventTypeLabel = (type: VENTURE_EVENT_TYPE): string => `venture.events.types.${type}`;
</script>

<template>
  <form class="grid w-full max-w-[600px] gap-4" @submit.prevent="onSubmit">
    <div>
      <FieldLabel :label="$t('venture.events.form.typeLabel')">
        <Select.Select v-model="form.type" :disabled="isPending">
          <Select.SelectTrigger>
            <Select.SelectValue />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <Select.SelectItem v-for="evType in availableEventTypes" :key="evType" :value="evType">
              {{ $t(eventTypeLabel(evType)) }}
            </Select.SelectItem>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <DateField v-model="form.eventDate" :label="$t('venture.events.form.eventDateLabel')" :disabled="isPending" />

    <InputField
      v-if="requiresGross"
      v-model="form.grossAmount"
      type="number"
      :decimals="amountDecimals"
      :label="$t('venture.events.form.grossAmountLabel')"
      :disabled="isPending"
    />

    <InputField
      v-if="requiresNav"
      v-model="form.navAfter"
      type="number"
      :decimals="amountDecimals"
      :label="$t('venture.events.form.navAfterLabel')"
      :disabled="isPending"
    />

    <VentureEventCashFlowPicker
      v-model:mode="form.cashFlowMode"
      v-model:transactions="selectedTransactions"
      :event-type="form.type"
      :currency-code="deal.currencyCode"
      :disabled="isPending"
    />

    <div v-if="isCarryBearing" class="grid gap-2">
      <label class="flex items-center gap-2 text-sm">
        <Checkbox v-model="form.overrideCarry" :disabled="isPending" />
        {{ $t('venture.events.form.overrideCarryLabel') }}
      </label>
      <div v-if="form.overrideCarry" class="grid grid-cols-2 gap-4">
        <InputField
          v-model="form.gpCarryOverride"
          type="number"
          :decimals="amountDecimals"
          :label="$t('venture.events.form.gpCarryLabel')"
          :disabled="isPending"
        />
        <InputField
          v-model="form.lpNetAmountOverride"
          type="number"
          :decimals="amountDecimals"
          :label="$t('venture.events.form.lpNetLabel')"
          :disabled="isPending"
        />
      </div>
    </div>

    <TextareaField
      v-model="form.notes"
      :label="$t('venture.events.form.notesLabel')"
      :placeholder="$t('venture.events.form.notesPlaceholder')"
      :disabled="isPending"
    />

    <div class="flex justify-end gap-2">
      <UiButton type="button" variant="secondary" :disabled="isPending" @click="emit('cancel')">
        {{ $t('venture.events.form.cancel') }}
      </UiButton>
      <UiButton type="submit" :disabled="isPending || !isFormValid">
        {{ isPending ? $t('venture.events.form.saving') : $t('venture.events.form.create') }}
      </UiButton>
    </div>
  </form>
</template>
