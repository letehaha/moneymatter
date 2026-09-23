<template>
  <DesktopOnlyTooltip :content="$t('settings.currencies.setBase.tooltip')">
    <Button
      variant="outline"
      size="sm"
      class="whitespace-nowrap"
      :disabled="isFormDisabled"
      @click="showBaseCurrencyDialog = true"
    >
      <StarIcon class="size-4" />
      <template v-if="changeBaseCurrencyMutation.isPending.value">
        {{ $t('settings.currencies.setBase.processing') }}
      </template>
      <template v-else>
        <span class="hidden @[450px]/currencies:inline">{{ $t('settings.currencies.setBase.button') }}</span>
        <span class="@[450px]/currencies:hidden">{{ $t('settings.currencies.setBase.buttonShort') }}</span>
      </template>
    </Button>
  </DesktopOnlyTooltip>

  <ResponsiveAlertDialog
    v-model:open="showBaseCurrencyDialog"
    :confirm-label="$t('settings.currencies.setBase.dialog.changeButton')"
    :cancel-label="$t('settings.currencies.setBase.dialog.cancelButton')"
    confirm-variant="destructive"
    @confirm="makeBaseCurrency"
  >
    <template #title>{{ $t('settings.currencies.setBase.dialog.title') }}</template>

    <template #description>
      <span class="grid gap-4">
        <span class="block">
          <strong class="text-warning-text font-bold">{{
            $t('settings.currencies.setBase.dialog.warningTitle')
          }}</strong>
          {{ $t('settings.currencies.setBase.dialog.warningText') }}
        </span>

        <span class="block">
          {{ $t('settings.currencies.setBase.dialog.descriptionText') }}
        </span>
      </span>
    </template>

    <div class="grid gap-4 text-sm">
      <Collapsible.Collapsible v-model:open="showRoundingDetails">
        <Collapsible.CollapsibleTrigger class="flex items-center gap-1 text-sm hover:opacity-80">
          <ChevronDownIcon
            class="size-4 transition-transform duration-200"
            :class="{ 'rotate-180': showRoundingDetails }"
          />
          {{ $t('settings.currencies.setBase.dialog.roundingTitle') }}
        </Collapsible.CollapsibleTrigger>
        <Collapsible.CollapsibleContent class="mt-2 text-sm opacity-90">
          <div class="bg-muted/40 rounded-md p-3">
            <p class="mb-2">
              {{ $t('settings.currencies.setBase.dialog.roundingIntro') }}
            </p>
            <p class="mb-1">
              <strong>{{ $t('settings.currencies.setBase.dialog.roundingHow') }}</strong>
            </p>
            <ul class="mb-2 list-disc space-y-1 pl-5">
              <li>{{ $t('settings.currencies.setBase.dialog.roundingRule1') }}</li>
              <li>{{ $t('settings.currencies.setBase.dialog.roundingRule2') }}</li>
            </ul>
            <p>
              {{ $t('settings.currencies.setBase.dialog.roundingStandard') }}
            </p>
            <p class="mt-2">
              <DocsLink path="/settings/base-currency-and-currencies/#what-gets-recalculated" />
            </p>
          </div>
        </Collapsible.CollapsibleContent>
      </Collapsible.Collapsible>

      <strong class="text-warning-text font-bold">
        <TriangleAlertIcon class="inline size-4 align-text-bottom" />
        {{ $t('settings.currencies.setBase.dialog.untouchedWarning') }}
      </strong>

      <strong class="font-bold">
        <InfoIcon class="inline size-4" />
        {{ $t('settings.currencies.setBase.dialog.processingTimeInfo') }}
      </strong>

      <strong class="text-warning-text font-bold">
        <TriangleAlertIcon class="inline size-4" />
        {{ $t('settings.currencies.setBase.dialog.restrictionWarning') }}
      </strong>

      <p>{{ $t('settings.currencies.setBase.dialog.confirmation') }}</p>
    </div>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Collapsible from '@/components/lib/ui/collapsible';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useChangeBaseCurrency } from '@/composable/data-queries/currencies';
import { useBaseCurrencyChangeStatus } from '@/composable/use-base-currency-change-status';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type BaseCurrencyBlocker } from '@bt/shared/types';
import { ChevronDownIcon, InfoIcon, StarIcon, TriangleAlertIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { CurrencyWithExchangeRate } from '../types';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const { addErrorNotification } = useNotificationCenter();
const changeBaseCurrencyMutation = useChangeBaseCurrency();
const baseCurrencyChangeStatus = useBaseCurrencyChangeStatus();
const { t } = useI18n();

const showBaseCurrencyDialog = ref(false);
const showRoundingDetails = ref(false);

// Exhaustive over the blocker union, so a new blocker type fails the type check
// instead of silently borrowing another one's wording. The fallback covers a server
// that sends a type this client build predates.
const LOCKED_MESSAGE_KEYS: Record<BaseCurrencyBlocker['type'], string> = {
  household: 'settings.currencies.setBase.errors.lockedHousehold',
  share: 'settings.currencies.setBase.errors.lockedShares',
  budget_plan: 'settings.currencies.setBase.errors.lockedBudgetPlan',
};

const buildLockedMessage = ({ blockers }: { blockers: BaseCurrencyBlocker[] }) =>
  blockers
    .map((b) =>
      t(LOCKED_MESSAGE_KEYS[b.type] ?? 'settings.currencies.setBase.errors.changeFailed', { count: b.count }, b.count),
    )
    .join(' ');

const makeBaseCurrency = async () => {
  // ResponsiveAlertDialog leaves closing to the parent; close before the async work
  // so the blocking overlay (or an error toast) is the only thing left on screen.
  showBaseCurrencyDialog.value = false;

  try {
    emit('trigger-disabled', true);
    const { jobId } = await changeBaseCurrencyMutation.mutateAsync(props.currency.currency!.code);

    // The recalculation runs as a background job; the blocking overlay takes over
    // from here and reloads the app once the change completes.
    baseCurrencyChangeStatus.start({ initialStatus: { state: 'queued', jobId } });

    emit('submit');
  } catch (e: unknown) {
    if (e instanceof ApiErrorResponseError) {
      const { code, details, message } = e.data ?? {};
      // A change is already running (another device won the race): the global 423
      // handler already raised the blocking overlay, so no error toast is warranted.
      if (code === API_ERROR_CODES.baseCurrencyChangeInProgress) {
        return;
      }
      if (
        code === API_ERROR_CODES.baseCurrencyLockedByHousehold ||
        code === API_ERROR_CODES.baseCurrencyLockedByShares ||
        code === API_ERROR_CODES.baseCurrencyLockedByBudgetPlan
      ) {
        const blockers = (details?.blockers as BaseCurrencyBlocker[] | undefined) ?? [];
        addErrorNotification(
          blockers.length
            ? buildLockedMessage({ blockers })
            : message || t('settings.currencies.setBase.errors.changeFailed'),
        );
        return;
      }
      if (code === API_ERROR_CODES.validationError && message) {
        addErrorNotification(message);
        return;
      }
    }
    addErrorNotification(t('settings.currencies.setBase.errors.changeFailed'));
  } finally {
    emit('trigger-disabled', false);
  }
};
</script>
