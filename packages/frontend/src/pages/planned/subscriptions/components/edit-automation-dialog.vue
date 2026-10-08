<script setup lang="ts">
import { type SubscriptionDetail, updateSubscription } from '@/api/subscriptions';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { isConnectedAccount } from '@/components/dialogs/manage-transaction/helpers';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { ApiErrorResponseError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_CATEGORIES, type AccountModel, type SubscriptionMatchingRule } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { HandCoinsIcon, SearchCheckIcon, ZapIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AUTOMATION_MODES,
  type AutomationMode,
  buildAutomationPayload,
  deriveAutomationMode,
  filterEmptyMatchingRules,
} from '../automation-editor-state';
import MatchingRulesBuilder from './matching-rules-builder.vue';

const props = defineProps<{ subscription: SubscriptionDetail }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();

const MODE_OPTIONS = computed(() => [
  {
    value: AUTOMATION_MODES.match,
    label: t('planned.subscriptions.editors.automation.modeMatchLabel'),
    desc: t('planned.subscriptions.editors.automation.modeMatchDesc'),
    icon: SearchCheckIcon,
  },
  {
    value: AUTOMATION_MODES.record,
    label: t('planned.subscriptions.editors.automation.modeRecordLabel'),
    desc: t('planned.subscriptions.editors.automation.modeRecordDesc'),
    icon: ZapIcon,
  },
  {
    value: AUTOMATION_MODES.manual,
    label: t('planned.subscriptions.editors.automation.modeManualLabel'),
    desc: t('planned.subscriptions.editors.automation.modeManualDesc'),
    icon: HandCoinsIcon,
  },
]);

const mode = ref<AutomationMode>(AUTOMATION_MODES.manual);
const rules = ref<SubscriptionMatchingRule[]>([]);
const accountId = ref<string | null>(null);
const formError = ref<string | null>(null);

const seedFromSubscription = () => {
  const storedRules = props.subscription.matchingRules?.rules ?? [];
  mode.value = deriveAutomationMode({ autoRecord: props.subscription.autoRecord, rules: storedRules });
  rules.value = JSON.parse(JSON.stringify(storedRules));
  accountId.value = props.subscription.accountId ?? null;
  formError.value = null;
};

seedFromSubscription();

watch(open, (isOpen) => {
  if (isOpen) seedFromSubscription();
});

const selectedAccount = computed(() =>
  accountId.value ? (accountsStore.accountsRecord[accountId.value] ?? null) : null,
);

const isRecordMode = computed(() => mode.value === AUTOMATION_MODES.record);

const accountOptions = computed(() =>
  isRecordMode.value
    ? accountsStore.txTargetableSourceAccountsActiveFirst
    : (accountsStore.accounts ?? []).filter(
        (account) =>
          account.accountCategory !== ACCOUNT_CATEGORIES.vehicle && account.accountCategory !== ACCOUNT_CATEGORIES.loan,
      ),
);

const isConnectedAccountForRecord = computed(
  () => isRecordMode.value && !!selectedAccount.value && isConnectedAccount({ account: selectedAccount.value }),
);

/** The auto-record cron books a concrete amount, so a variable-amount subscription can't use it. */
const isMissingAmountForRecord = computed(
  () =>
    isRecordMode.value &&
    !(
      typeof props.subscription.expectedAmount === 'number' &&
      props.subscription.expectedAmount > 0 &&
      typeof props.subscription.expectedCurrencyCode === 'string' &&
      props.subscription.expectedCurrencyCode.length > 0
    ),
);

const effectiveRulesCount = computed(() => filterEmptyMatchingRules({ rules: rules.value }).length);

/** A match with no usable rule would save as an identical payload to manual mode. */
const isMatchWithoutRules = computed(() => mode.value === AUTOMATION_MODES.match && effectiveRulesCount.value === 0);

const { mutate, isPending } = useMutation({
  mutationFn: (payload: Parameters<typeof updateSubscription>[0]['payload']) =>
    updateSubscription({ id: props.subscription.id, payload }),
  onSuccess: () => {
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.updateSuccess'));
    open.value = false;
  },
  onError: (err) => {
    formError.value =
      err instanceof ApiErrorResponseError
        ? (err.data.message ?? t('planned.subscriptions.updateError'))
        : t('planned.subscriptions.updateError');
  },
});

const isSaveDisabled = computed(
  () =>
    isPending.value ||
    isMissingAmountForRecord.value ||
    isConnectedAccountForRecord.value ||
    (isRecordMode.value && !accountId.value) ||
    isMatchWithoutRules.value,
);

const handleSubmit = () => {
  formError.value = null;
  mutate(buildAutomationPayload({ mode: mode.value, rules: rules.value, accountId: accountId.value }));
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-lg">
    <template #title>{{ $t('planned.subscriptions.editors.automation.title') }}</template>
    <template #description>{{ $t('planned.subscriptions.editors.automation.description') }}</template>

    <form id="edit-subscription-automation" class="grid gap-4" @submit.prevent="handleSubmit">
      <div class="grid gap-2">
        <label
          v-for="option in MODE_OPTIONS"
          :key="option.value"
          :class="
            cn(
              'border-input flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
              mode === option.value ? 'border-primary bg-primary/5' : 'hover:bg-accent/40',
            )
          "
        >
          <input
            type="radio"
            class="sr-only"
            :value="option.value"
            :checked="mode === option.value"
            @change="mode = option.value"
          />
          <span
            :class="
              cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md border',
                mode === option.value ? 'border-primary/40 text-primary-text' : 'border-input text-muted-foreground',
              )
            "
          >
            <component :is="option.icon" class="size-4" />
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm leading-tight font-medium">{{ option.label }}</span>
            <span class="text-muted-foreground text-xs leading-snug">{{ option.desc }}</span>
          </span>
        </label>
      </div>

      <div class="grid gap-1.5">
        <AccountSelectField
          :model-value="selectedAccount"
          :accounts="accountOptions"
          :label="$t('planned.subscriptions.form.accountLabel')"
          :placeholder="$t('planned.subscriptions.form.noAccount')"
          :required="isRecordMode"
          clearable
          @update:model-value="(account: AccountModel | null) => (accountId = account?.id ?? null)"
        />
        <p class="text-muted-foreground text-xs">
          {{
            isRecordMode
              ? $t('planned.subscriptions.editors.automation.accountRequiredHint')
              : $t('planned.subscriptions.editors.automation.accountOptionalHint')
          }}
        </p>
      </div>

      <Callout v-if="isMissingAmountForRecord" variant="warning">
        <span class="text-xs">{{ $t('planned.subscriptions.editors.automation.recordNeedsAmount') }}</span>
      </Callout>

      <Callout v-if="isConnectedAccountForRecord" variant="warning">
        <span class="text-xs">{{ $t('planned.subscriptions.editors.automation.recordNeedsManualAccount') }}</span>
      </Callout>

      <div v-if="mode === AUTOMATION_MODES.match" class="grid gap-2">
        <p class="text-muted-foreground text-xs">{{ $t('planned.subscriptions.form.matchingRulesDescription') }}</p>
        <MatchingRulesBuilder v-model="rules" />
        <p v-if="isMatchWithoutRules" class="text-muted-foreground text-xs">
          {{ $t('planned.subscriptions.editors.automation.matchNeedsRule') }}
        </p>
      </div>

      <Callout v-if="formError" variant="destructive">
        <span>{{ formError }}</span>
      </Callout>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          {{ $t('planned.subscriptions.cancel') }}
        </Button>
        <Button type="submit" form="edit-subscription-automation" :disabled="isSaveDisabled">
          {{ $t('planned.subscriptions.form.update') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
