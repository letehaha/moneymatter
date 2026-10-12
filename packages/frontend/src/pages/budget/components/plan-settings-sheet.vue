<script setup lang="ts">
import { deleteBudgetPlan, loadBudgetPlans, setBudgetPlanAccounts, updateBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { notifyMutationError, useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  ACCOUNT_STATUSES,
  type AccountModel,
  BUDGET_PLAN_NAME_MAX_LENGTH,
  BUDGET_PLAN_TRASH_RETENTION_DAYS,
  type BudgetPlanCarryPolicy,
  type BudgetPlanDetails,
} from '@bt/shared/types';
import { ChevronRightIcon, LockIcon } from '@lucide/vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { parseISO } from 'date-fns';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  BUDGET_POOL_ENABLED,
  CARRY_POLICY_OPTIONS,
  cadenceLabel,
  isAttachableAccount,
  trashedPlansOf,
} from '../helpers';
import DeletedPlansDialog from './deleted-plans-dialog.vue';

// Each save returns the full plan into the cache, so one scope runs them in order and the last response wins.
const SETTINGS_MUTATION_SCOPE = { id: 'budget-plan-settings' };

const props = defineProps<{ plan: BudgetPlanDetails }>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification } = useNotificationCenter();
const { format } = useDateLocale();

const name = ref(props.plan.plan.name);
// Blur and Enter both reach the input, so the last submitted value guards against a duplicate PATCH.
const submittedName = ref(props.plan.plan.name);
const selectedAccountIds = ref(props.plan.accountIds);
const accountsError = ref('');
const isDeleteOpen = ref(false);
const isPoolConfirmOpen = ref(false);
const isTrashOpen = ref(false);

const { data: allPlans } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.budgetPlansList,
  queryFn: loadBudgetPlans,
  enabled: isOpen,
});

const trashedPlans = computed(() => trashedPlansOf({ plans: allPlans.value ?? [] }));

watch(isOpen, () => {
  accountsError.value = '';
});

watch(
  () => props.plan.plan.name,
  (value) => {
    name.value = value;
    submittedName.value = value;
  },
);

const planId = computed(() => props.plan.plan.id);

const periodLabel = computed(() => {
  const { key, params } = cadenceLabel({
    cadence: props.plan.plan.cadence,
    intervalN: props.plan.plan.intervalN,
  });
  return t(key, params);
});

const startsOnLabel = computed(() =>
  t('budgetPlans.settings.startsOn', {
    date: format(parseISO(props.plan.plan.epochDate), 'd MMM yyyy'),
  }),
);

const onSaved = ({ details }: { details: BudgetPlanDetails }) => {
  queryClient.setQueryData([...VUE_QUERY_CACHE_KEYS.budgetPlan, planId.value], details);
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans });
  addSuccessNotification(t('budgetPlans.settings.saved'));
};

const { isPending: isPatching, mutate: patchPlan } = useMutation({
  mutationFn: updateBudgetPlan,
  scope: SETTINGS_MUTATION_SCOPE,
  onSuccess: (details) => onSaved({ details }),
  onError: (error) => notifyMutationError({ error, fallbackKey: 'budgetPlans.settings.error' }),
});

const { isPending: isRenaming, mutate: renamePlan } = useMutation({
  mutationFn: updateBudgetPlan,
  scope: SETTINGS_MUTATION_SCOPE,
  onSuccess: (details) => onSaved({ details }),
  onError: (error) => {
    name.value = props.plan.plan.name;
    submittedName.value = props.plan.plan.name;
    notifyMutationError({ error, fallbackKey: 'budgetPlans.settings.error' });
  },
});

const { isPending: isSavingAccounts, mutate: saveAccounts } = useMutation({
  mutationFn: setBudgetPlanAccounts,
  scope: SETTINGS_MUTATION_SCOPE,
  onSuccess: (details) => onSaved({ details }),
  onError: (error) => {
    selectedAccountIds.value = props.plan.accountIds;
    notifyMutationError({ error, fallbackKey: 'budgetPlans.settings.error' });
  },
});

// Quick successive toggles each PUT the full list, so a mid-flight refetch must not rewind the local one.
watch(
  () => props.plan.accountIds,
  (accountIds) => {
    if (!isSavingAccounts.value) selectedAccountIds.value = accountIds;
  },
);

const isOfferedAccount = ({ account }: { account: AccountModel }) =>
  isAttachableAccount({ account }) &&
  (account.status === ACCOUNT_STATUSES.active || props.plan.accountIds.includes(account.id));

const leaveTrashedPlan = () => {
  // Removed, not invalidated: the budget page would read the cached list and redirect back to this plan.
  queryClient.removeQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans });
  isTrashOpen.value = false;
  isOpen.value = false;
  router.push({ name: ROUTES_NAMES.budget });
};

const { isPending: isDeleting, mutate: removePlan } = useInvalidatingMutation({
  mutationFn: deleteBudgetPlan,
  invalidateKeys: [],
  successKey: 'budgetPlans.settings.deleted',
  errorKey: 'budgetPlans.settings.deleteError',
  onSuccess: () => {
    isDeleteOpen.value = false;
    leaveTrashedPlan();
  },
});

const submitName = () => {
  const trimmed = name.value.trim();
  if (!trimmed) {
    name.value = props.plan.plan.name;
    return;
  }
  if (trimmed === submittedName.value) return;
  submittedName.value = trimmed;
  renamePlan({ planId: planId.value, payload: { name: trimmed } });
};

const setPoolEnabled = ({ value }: { value: boolean }) => {
  if (value) isPoolConfirmOpen.value = true;
  else patchPlan({ planId: planId.value, payload: { poolEnabled: false } });
};

const enablePool = () => {
  isPoolConfirmOpen.value = false;
  patchPlan({ planId: planId.value, payload: { poolEnabled: true } });
};

const setCarryPolicy = ({ value }: { value: unknown }) =>
  patchPlan({
    planId: planId.value,
    payload: { carryPolicy: value as BudgetPlanCarryPolicy },
  });

const submitAccounts = ({ accountIds }: { accountIds: string[] }) => {
  if (!accountIds.length) {
    accountsError.value = t('budgetPlans.settings.accountsRequired');
    return;
  }
  accountsError.value = '';
  selectedAccountIds.value = accountIds;
  saveAccounts({ planId: planId.value, accountIds });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('budgetPlans.settings.title') }}</template>
    <template #description>{{ $t('budgetPlans.settings.description') }}</template>

    <div class="grid gap-6">
      <div class="grid gap-2">
        <InputField
          v-model="name"
          :label="$t('budgetPlans.settings.nameLabel')"
          :placeholder="$t('budgetPlans.settings.namePlaceholder')"
          :maxlength="BUDGET_PLAN_NAME_MAX_LENGTH"
          :disabled="isRenaming"
          @blur="submitName"
          @keydown.enter.prevent="submitName"
        />

        <Callout variant="info" :icon="LockIcon">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <p class="text-foreground">
              <span class="sr-only">{{ $t('budgetPlans.settings.periodLabel') }}:</span>
              {{ periodLabel }} · {{ startsOnLabel }}
            </p>
            <p class="text-xs">{{ $t('budgetPlans.settings.cadenceLocked') }}</p>
          </div>
        </Callout>
      </div>

      <div class="grid gap-3">
        <AccountMultiSelectField
          :model-value="selectedAccountIds"
          :label="$t('budgetPlans.settings.accountsLabel')"
          :placeholder="$t('budgetPlans.settings.accountsPlaceholder')"
          :error-message="accountsError"
          :filter-accounts="(account) => isOfferedAccount({ account })"
          include-archived
          :disabled="isSavingAccounts"
          @update:model-value="(accountIds) => submitAccounts({ accountIds })"
        />

        <div class="flex items-center justify-between gap-3">
          <Label for="budget-auto-attach" class="cursor-pointer text-sm font-normal">
            {{ $t('budgetPlans.settings.autoAttachLabel') }}
          </Label>
          <Switch
            id="budget-auto-attach"
            :model-value="plan.plan.autoAttachAccounts"
            :disabled="isPatching"
            @update:model-value="
              (value) =>
                patchPlan({
                  planId,
                  payload: { autoAttachAccounts: Boolean(value) },
                })
            "
          />
        </div>
      </div>

      <div v-if="BUDGET_POOL_ENABLED" class="grid gap-3">
        <div class="grid gap-1">
          <div class="flex items-center justify-between gap-3">
            <Label for="budget-pool" class="cursor-pointer text-sm font-normal">
              {{ $t('budgetPlans.pool.settingLabel') }}
            </Label>
            <Switch
              id="budget-pool"
              :model-value="plan.plan.poolFrom !== null"
              :disabled="isPatching"
              @update:model-value="(value) => setPoolEnabled({ value: Boolean(value) })"
            />
          </div>
          <p class="text-muted-foreground text-xs">
            {{ $t('budgetPlans.pool.settingHint') }}
          </p>
        </div>

        <div v-if="plan.plan.poolFrom !== null" class="grid gap-1">
          <div class="flex items-center justify-between gap-3">
            <Label for="budget-zero-sum" class="cursor-pointer text-sm font-normal">
              {{ $t('budgetPlans.pool.zeroSumLabel') }}
            </Label>
            <Switch
              id="budget-zero-sum"
              :model-value="plan.plan.zeroSum"
              :disabled="isPatching"
              @update:model-value="(value) => patchPlan({ planId, payload: { zeroSum: Boolean(value) } })"
            />
          </div>
          <p class="text-muted-foreground text-xs">
            {{ $t('budgetPlans.pool.zeroSumHint') }}
            <DocsLink path="/budgeting/ready-to-assign/#keep-ready-to-assign-at-0" class="text-xs" />
          </p>
        </div>
      </div>

      <div class="grid gap-2">
        <FieldLabel :label="$t('budgetPlans.settings.rolloverLabel')" only-template>
          <RadioGroup
            :model-value="plan.plan.carryPolicy"
            :disabled="isPatching"
            @update:model-value="(value) => setCarryPolicy({ value })"
          >
            <div v-for="option in CARRY_POLICY_OPTIONS" :key="option.value" class="flex items-start gap-2">
              <RadioGroupItem :id="`budget-carry-${option.value}`" :value="option.value" class="mt-0.5" />
              <Label :for="`budget-carry-${option.value}`" class="grid cursor-pointer gap-0.5 font-normal">
                <span class="text-sm">{{ $t(option.labelKey) }}</span>
                <span class="text-muted-foreground text-xs">
                  {{ $t(`budgetPlans.settings.carryDescription.${option.value}`) }}
                </span>
              </Label>
            </div>
          </RadioGroup>
        </FieldLabel>
        <p class="text-muted-foreground text-xs">
          {{ $t('budgetPlans.settings.rolloverNote') }}
          <DocsLink path="/budgeting/assigning-and-rollover/#rollover" class="text-xs" />
        </p>
      </div>

      <div class="grid gap-4 border-t pt-4">
        <Button
          v-if="trashedPlans.length"
          variant="ghost"
          class="-mx-2 h-auto justify-between gap-3 px-2 py-1.5 text-left whitespace-normal"
          @click="isTrashOpen = true"
        >
          <span class="grid min-w-0 gap-0.5">
            <span class="text-sm font-medium">{{ $t('budgetPlans.trashed.settingsRow') }}</span>
            <span class="text-muted-foreground text-xs font-normal">
              {{
                $t(
                  'budgetPlans.trashed.settingsRowHint',
                  { count: trashedPlans.length, days: BUDGET_PLAN_TRASH_RETENTION_DAYS },
                  trashedPlans.length,
                )
              }}
            </span>
          </span>
          <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
        </Button>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="grid min-w-0 gap-0.5">
            <p class="text-sm font-medium">{{ $t('budgetPlans.settings.deleteTitle') }}</p>
            <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.settings.deleteCaption') }}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive-text hover:text-destructive-text shrink-0"
            :disabled="isDeleting"
            @click="isDeleteOpen = true"
          >
            {{ $t('budgetPlans.settings.delete') }}
          </Button>
        </div>
      </div>
    </div>
  </ResponsiveDialog>

  <DeletedPlansDialog
    v-model:open="isTrashOpen"
    :plans="trashedPlans"
    :active-plan="plan.plan"
    @replaced="leaveTrashedPlan"
  />

  <ResponsiveAlertDialog
    v-model:open="isPoolConfirmOpen"
    :confirm-label="$t('budgetPlans.pool.enableConfirm')"
    :confirm-disabled="isPatching"
    @confirm="enablePool"
  >
    <template #title>{{ $t('budgetPlans.pool.enableConfirmTitle') }}</template>
    <template #description>{{ $t('budgetPlans.pool.enableConfirmDescription') }}</template>
  </ResponsiveAlertDialog>

  <ResponsiveAlertDialog
    v-model:open="isDeleteOpen"
    :confirm-label="$t('budgetPlans.settings.delete')"
    confirm-variant="destructive"
    :confirm-disabled="isDeleting"
    @confirm="removePlan({ planId })"
  >
    <template #title>{{ $t('budgetPlans.settings.deleteConfirmTitle') }}</template>
    <template #description>{{ $t('budgetPlans.settings.deleteConfirmDescription') }}</template>
  </ResponsiveAlertDialog>
</template>
