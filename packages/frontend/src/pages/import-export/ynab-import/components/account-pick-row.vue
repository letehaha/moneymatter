<template>
  <div class="bg-muted/30 fields-plain rounded-md border px-4 py-3" :class="isSkipped ? 'opacity-60' : ''">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="truncate font-medium">{{ account.originalName }}</span>
        <span class="text-muted-foreground text-xs whitespace-nowrap">
          {{
            $t('pages.importExport.ynabImport.accountRow.transactionsCount', {
              count: account.transactionCount,
            })
          }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-muted-foreground text-xs whitespace-nowrap">
          {{ $t('pages.importExport.ynabImport.accountRow.startingBalance') }}:
          <span class="text-foreground ml-1 text-sm font-semibold">
            {{ formattedStartingBalance }}
          </span>
        </div>
        <DesktopOnlyTooltip :content="skipToggleLabel">
          <UiButton variant="ghost" size="icon-sm" :aria-label="skipToggleLabel" @click="emit('toggle-skip')">
            <Undo2Icon v-if="isSkipped" class="size-4" />
            <BanIcon v-else class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <div class="max-w-xs">
      <SelectField
        :model-value="selectedCurrency"
        :values="currencyOptions"
        :pinned-group="linkedCurrencyGroup"
        label-key="displayLabel"
        value-key="code"
        with-search
        :search-keys="['code', 'currency']"
        :disabled="isSkipped"
        :label="$t('pages.importExport.ynabImport.accountRow.currencyLabel')"
        :placeholder="$t('pages.importExport.ynabImport.accountRow.currencyPlaceholder')"
        :error-message="currencyErrorMessage"
        @update:model-value="onCurrencySelected"
      />
    </div>

    <p v-if="isSkipped" class="text-muted-foreground mt-2 text-sm">
      {{ $t('importShared.account.willSkip') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { Button as UiButton } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useLinkedCurrencyGroup } from '@/composable/use-linked-currency-group';
import { formatUIAmount } from '@/js/helpers';
import type { YnabAccountMappingValue, YnabParseAccount } from '@bt/shared/types';
import { BanIcon, Undo2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { CurrencyOption } from './preview-step.vue';

const CURRENCY_CODE_LENGTH = 3;

const props = defineProps<{
  account: YnabParseAccount;
  mapping: YnabAccountMappingValue | undefined;
  currencyOptions: CurrencyOption[];
}>();

const emit = defineEmits<{
  (e: 'update', mapping: YnabAccountMappingValue): void;
  (e: 'toggle-skip'): void;
}>();

const { t } = useI18n();
const linkedCurrencyGroup = useLinkedCurrencyGroup();

const isSkipped = computed(() => props.mapping?.skip === true);

const skipToggleLabel = computed(() =>
  isSkipped.value ? t('pages.importExport.ynabImport.accountRow.undoSkip') : t('importShared.action.skip'),
);

const formattedStartingBalance = computed(() =>
  formatUIAmount(props.account.startingBalance, {
    currency: props.mapping?.currencyCode || props.account.detectedCurrency || undefined,
  }),
);

const selectedCurrency = computed<CurrencyOption | null>(() => {
  if (!props.mapping?.currencyCode) return null;
  return props.currencyOptions.find((c) => c.code === props.mapping!.currencyCode) ?? null;
});

const currencyErrorMessage = computed(() => {
  if (isSkipped.value) return undefined;
  if (props.mapping?.currencyCode.length === CURRENCY_CODE_LENGTH) return undefined;
  return t('pages.importExport.ynabImport.accountRow.currencyInvalid');
});

function onCurrencySelected(currency: CurrencyOption | null) {
  if (!currency) return;
  emit('update', { ...props.mapping, currencyCode: currency.code });
}
</script>
