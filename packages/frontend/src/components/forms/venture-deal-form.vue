<script setup lang="ts">
import HintIcon from '@/components/common/hint-icon.vue';
import DateField from '@/components/fields/date-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { getErrorMessage } from '@/common/utils/error-message';
import { fractionToPercentInput, isPercentInputValid, percentInputToFraction } from '@/common/utils/percentage';
import { isPositiveDecimal } from '@/common/utils/validators';
import { useCurrencyDecimalRule } from '@/composable/use-currency-decimal-rule';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useCreateVentureDeal, useUpdateVentureDeal } from '@/composable/data-queries/venture/deals';
import { useVenturePlatforms } from '@/composable/data-queries/venture/platforms';
import { useCurrenciesStore } from '@/stores';
import { VENTURE_SPV_SUBTYPE, type VentureDealModel, type VenturePlatformModel } from '@bt/shared/types';
import { format } from 'date-fns';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const { addNotification } = useNotificationCenter();

interface Emit {
  (e: 'saved', deal: VentureDealModel): void;
  (e: 'cancel'): void;
}

const props = defineProps<{
  deal?: VentureDealModel | null;
}>();

const emit = defineEmits<Emit>();

const createMutation = useCreateVentureDeal();
const updateMutation = useUpdateVentureDeal();
const { data: platformsData } = useVenturePlatforms();
const platforms = computed<VenturePlatformModel[]>(() => platformsData.value?.data ?? []);

const currenciesStore = useCurrenciesStore();
const userCurrencies = computed(() => currenciesStore.currencies.filter((c) => !c.currency?.isCustom));

const NO_PLATFORM = '__none__';

// Parse `YYYY-MM-DD` from API → local-midnight Date so the calendar shows the same day.
const parseApiDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const formatApiDate = (d: Date): string => format(d, 'yyyy-MM-dd');

const form = reactive({
  name: '',
  platformId: NO_PLATFORM as string,
  currencyCode: currenciesStore.baseCurrency?.currencyCode ?? 'USD',
  principal: '0',
  entryFee: '',
  spvSubtype: VENTURE_SPV_SUBTYPE.multi_company as VENTURE_SPV_SUBTYPE,
  targetCompany: '',
  investmentDate: new Date() as Date,
  expectedExitDate: null as Date | null,
  notes: '',
  entryFeePctPercent: '0',
  mgmtFeePctPercent: '0',
  carryPctPercent: '20',
  hurdlePctPercent: '0',
});

// Auto-fill fees from platform defaults when platform changes (creation only)
watch(
  () => form.platformId,
  (newPlatformId) => {
    if (props.deal) return; // never overwrite existing deal values during edit
    if (!newPlatformId || newPlatformId === NO_PLATFORM) return;
    const platform = platforms.value.find((p) => p.id === newPlatformId);
    if (!platform) return;
    form.entryFeePctPercent = fractionToPercentInput(platform.defaultEntryFeePct);
    form.mgmtFeePctPercent = fractionToPercentInput(platform.defaultMgmtFeePct);
    form.carryPctPercent = fractionToPercentInput(platform.defaultCarryPct);
    form.hurdlePctPercent = fractionToPercentInput(platform.defaultHurdlePct);
  },
);

watch(
  () => props.deal,
  (d) => {
    if (!d) return;
    form.name = d.name;
    form.platformId = d.platformId ?? NO_PLATFORM;
    form.currencyCode = d.currencyCode;
    form.principal = String(Number(d.principal));
    form.entryFee = String(Number(d.entryFee));
    form.spvSubtype = d.spvSubtype ?? VENTURE_SPV_SUBTYPE.multi_company;
    form.targetCompany = d.targetCompany ?? '';
    form.investmentDate = parseApiDate(d.investmentDate);
    form.expectedExitDate = d.expectedExitDate ? parseApiDate(d.expectedExitDate) : null;
    form.notes = d.notes ?? '';
    form.entryFeePctPercent = fractionToPercentInput(d.entryFeePct);
    form.mgmtFeePctPercent = fractionToPercentInput(d.mgmtFeePct);
    form.carryPctPercent = fractionToPercentInput(d.carryPct);
    form.hurdlePctPercent = fractionToPercentInput(d.hurdlePct);
  },
  { immediate: true },
);

const isPending = computed(() => createMutation.isPending.value || updateMutation.isPending.value);

const currencyDecimal = useCurrencyDecimalRule({ decimals: () => getCurrencyDecimals({ code: form.currencyCode }) });
const decimalError = ({ value }: { value: unknown }) =>
  currencyDecimal.isValid(value) ? undefined : currencyDecimal.message.value;

const isFormValid = computed(
  () =>
    form.name.trim().length > 0 &&
    currencyDecimal.isValid(form.principal) &&
    currencyDecimal.isValid(form.entryFee) &&
    form.currencyCode.length === 3 &&
    isPositiveDecimal(form.principal) &&
    form.investmentDate instanceof Date &&
    !Number.isNaN(form.investmentDate.getTime()) &&
    isPercentInputValid(form.entryFeePctPercent) &&
    isPercentInputValid(form.mgmtFeePctPercent) &&
    isPercentInputValid(form.carryPctPercent) &&
    isPercentInputValid(form.hurdlePctPercent),
);

// `InputField type="number"` emits JS numbers, and Money fields come back from
// the API serialized as numbers too — so form values may be string OR number.
// Coerce defensively before `.trim()` to avoid "principal.trim is not a function"
// on the edit path.
const toStr = (val: unknown): string => (val == null ? '' : String(val).trim());

const buildPayload = () => ({
  name: toStr(form.name),
  currencyCode: form.currencyCode,
  principal: form.principal,
  investmentDate: formatApiDate(form.investmentDate),
  platformId: form.platformId === NO_PLATFORM ? null : form.platformId,
  spvSubtype: form.spvSubtype,
  targetCompany: toStr(form.targetCompany) || null,
  entryFeePct: percentInputToFraction(form.entryFeePctPercent),
  ...(toStr(form.entryFee) !== '' && { entryFee: toStr(form.entryFee) }),
  mgmtFeePct: percentInputToFraction(form.mgmtFeePctPercent),
  carryPct: percentInputToFraction(form.carryPctPercent),
  hurdlePct: percentInputToFraction(form.hurdlePctPercent),
  expectedExitDate: form.expectedExitDate ? formatApiDate(form.expectedExitDate) : null,
  notes: toStr(form.notes) || null,
});

const onSubmit = async () => {
  if (!isFormValid.value) return;
  try {
    const payload = buildPayload();
    const saved = props.deal
      ? await updateMutation.mutateAsync({ dealId: props.deal.id, payload })
      : await createMutation.mutateAsync(payload);

    addNotification({
      text: props.deal ? t('venture.deals.notifications.updated') : t('venture.deals.notifications.created'),
      type: NotificationType.success,
    });
    emit('saved', saved);
  } catch (err) {
    addNotification({
      text: getErrorMessage(err, t('venture.deals.notifications.error')),
      type: NotificationType.error,
    });
  }
};
</script>

<template>
  <form class="grid w-full max-w-150 gap-4" @submit.prevent="onSubmit">
    <InputField
      v-model="form.name"
      :label="$t('venture.deals.form.nameLabel')"
      :placeholder="$t('venture.deals.form.namePlaceholder')"
      :disabled="isPending"
      :error="!form.name.trim() && $t('venture.deals.form.nameRequired')"
    />

    <div>
      <FieldLabel :label="$t('venture.deals.form.platformLabel')">
        <Select.Select v-model="form.platformId" :disabled="isPending">
          <Select.SelectTrigger>
            <Select.SelectValue :placeholder="$t('venture.deals.form.platformPlaceholder')" />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <Select.SelectItem :value="NO_PLATFORM">{{ $t('venture.deals.form.noPlatform') }}</Select.SelectItem>
            <Select.SelectItem v-for="p in platforms" :key="p.id" :value="p.id">{{ p.name }}</Select.SelectItem>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <FieldLabel :label="$t('venture.deals.form.currencyLabel')">
          <Select.Select v-model="form.currencyCode" :disabled="isPending">
            <Select.SelectTrigger>
              <Select.SelectValue :placeholder="$t('venture.deals.form.currencyPlaceholder')" />
            </Select.SelectTrigger>
            <Select.SelectContent>
              <Select.SelectItem v-for="c in userCurrencies" :key="c.currencyCode" :value="c.currencyCode">
                {{ c.currencyCode }}
              </Select.SelectItem>
            </Select.SelectContent>
          </Select.Select>
        </FieldLabel>
      </div>
      <div>
        <FieldLabel :label="$t('venture.deals.form.subtypeLabel')">
          <template #label-after>
            <HintIcon :content="$t('venture.deals.form.subtypeHint')" />
          </template>
          <Select.Select v-model="form.spvSubtype" :disabled="isPending">
            <Select.SelectTrigger>
              <Select.SelectValue />
            </Select.SelectTrigger>
            <Select.SelectContent>
              <Select.SelectItem :value="VENTURE_SPV_SUBTYPE.multi_company">
                {{ $t('venture.deals.form.subtypeMulti') }}
              </Select.SelectItem>
              <Select.SelectItem :value="VENTURE_SPV_SUBTYPE.single_company">
                {{ $t('venture.deals.form.subtypeSingle') }}
              </Select.SelectItem>
            </Select.SelectContent>
          </Select.Select>
        </FieldLabel>
      </div>
    </div>

    <InputField
      v-model="form.targetCompany"
      :label="$t('venture.deals.form.targetCompanyLabel')"
      :placeholder="$t('venture.deals.form.targetCompanyPlaceholder')"
      :disabled="isPending"
    >
      <template #label-after>
        <HintIcon :content="$t('venture.deals.form.targetCompanyHint')" />
      </template>
    </InputField>

    <div class="grid grid-cols-2 gap-4">
      <InputField
        v-model="form.principal"
        type="number"
        :decimals="getCurrencyDecimals({ code: form.currencyCode })"
        :label="$t('venture.deals.form.principalLabel')"
        :disabled="isPending"
        :error="!isPositiveDecimal(form.principal) && $t('venture.deals.form.principalInvalid')"
        :error-message="decimalError({ value: form.principal })"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.principalHint')" />
        </template>
      </InputField>
      <InputField
        v-model="form.entryFee"
        type="number"
        :decimals="getCurrencyDecimals({ code: form.currencyCode })"
        :label="$t('venture.deals.form.entryFeeLabel')"
        :placeholder="$t('venture.deals.form.entryFeeAutoHint')"
        :disabled="isPending"
        :error-message="decimalError({ value: form.entryFee })"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.entryFeeHint')" />
        </template>
      </InputField>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <DateField
        v-model="form.investmentDate"
        :label="$t('venture.deals.form.investmentDateLabel')"
        :disabled="isPending"
      />
      <DateField
        :model-value="form.expectedExitDate ?? undefined"
        :label="$t('venture.deals.form.expectedExitDateLabel')"
        :calendar-options="{ minDate: form.investmentDate }"
        :disabled="isPending"
        @update:model-value="(v: Date | null) => (form.expectedExitDate = v)"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.expectedExitDateHint')" />
        </template>
      </DateField>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <InputField
        v-model="form.entryFeePctPercent"
        type="number"
        step="0.01"
        :label="$t('venture.deals.form.entryFeePctLabel')"
        :disabled="isPending"
        :error="!isPercentInputValid(form.entryFeePctPercent) && $t('venture.deals.form.percentInvalid')"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.entryFeePctHint')" />
        </template>
      </InputField>
      <InputField
        v-model="form.mgmtFeePctPercent"
        type="number"
        step="0.01"
        :label="$t('venture.deals.form.mgmtFeePctLabel')"
        :disabled="isPending"
        :error="!isPercentInputValid(form.mgmtFeePctPercent) && $t('venture.deals.form.percentInvalid')"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.mgmtFeePctHint')" />
        </template>
      </InputField>
      <InputField
        v-model="form.carryPctPercent"
        type="number"
        step="0.01"
        :label="$t('venture.deals.form.carryPctLabel')"
        :disabled="isPending"
        :error="!isPercentInputValid(form.carryPctPercent) && $t('venture.deals.form.percentInvalid')"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.carryPctHint')" />
        </template>
      </InputField>
      <InputField
        v-model="form.hurdlePctPercent"
        type="number"
        step="0.01"
        :label="$t('venture.deals.form.hurdlePctLabel')"
        :disabled="isPending"
        :error="!isPercentInputValid(form.hurdlePctPercent) && $t('venture.deals.form.percentInvalid')"
      >
        <template #label-after>
          <HintIcon :content="$t('venture.deals.form.hurdlePctHint')" />
        </template>
      </InputField>
    </div>

    <TextareaField
      v-model="form.notes"
      :label="$t('venture.deals.form.notesLabel')"
      :placeholder="$t('venture.deals.form.notesPlaceholder')"
      :disabled="isPending"
    />

    <div class="flex justify-end gap-2">
      <UiButton type="button" variant="secondary" :disabled="isPending" @click="emit('cancel')">
        {{ $t('venture.deals.form.cancel') }}
      </UiButton>
      <UiButton type="submit" :disabled="isPending || !isFormValid">
        {{
          isPending
            ? $t('venture.deals.form.saving')
            : props.deal
              ? $t('venture.deals.form.save')
              : $t('venture.deals.form.create')
        }}
      </UiButton>
    </div>
  </form>
</template>
