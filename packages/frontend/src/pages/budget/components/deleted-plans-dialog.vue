<script setup lang="ts">
import { purgeBudgetPlan, restoreBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores';
import { BUDGET_PLAN_TRASH_RETENTION_DAYS, type BudgetPlanModel } from '@bt/shared/types';
import { Loader2Icon, Trash2Icon, TriangleAlertIcon, Undo2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { type TrashedBudgetPlan, cadenceLabel, trashDaysLeft } from '../helpers';

const EXPIRING_SOON_DAYS = 7;

const props = defineProps<{
  plans: TrashedBudgetPlan[];
  activePlan?: { id: string; name: string };
}>();
const emit = defineEmits<{ replaced: [] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { format } = useDateLocale();
const { baseCurrency } = storeToRefs(useCurrenciesStore());

const rows = computed(() =>
  props.plans.map((plan) => ({
    plan,
    cadence: cadenceLabel({ cadence: plan.cadence, intervalN: plan.intervalN }),
    deletedOn: format(parseISO(plan.deletedAt), 'd MMM'),
    daysLeft: trashDaysLeft({ deletedAt: plan.deletedAt }),
    // The backend refuses to restore a plan budgeted in another base currency.
    isRestorable: plan.currencyCode === baseCurrency.value?.currencyCode,
  })),
);

const {
  isPending: isRestoring,
  variables: restoring,
  mutate: restore,
} = useInvalidatingMutation({
  mutationFn: restoreBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.trashed.restored',
  errorKey: 'budgetPlans.trashed.restoreError',
});

const replaceCandidate = ref<BudgetPlanModel | null>(null);
const isReplaceOpen = ref(false);

const queryClient = useQueryClient();

// Removed, not invalidated: a refetch would redirect back to the plan that just went to the trash.
const { isPending: isReplacing, mutate: replace } = useInvalidatingMutation({
  mutationFn: restoreBudgetPlan,
  invalidateKeys: [],
  successKey: 'budgetPlans.trashed.restored',
  errorKey: 'budgetPlans.trashed.restoreError',
  onSuccess: () => {
    queryClient.removeQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans });
    isReplaceOpen.value = false;
    emit('replaced');
  },
});

const askRestore = ({ plan }: { plan: BudgetPlanModel }) => {
  if (!props.activePlan) return restore({ planId: plan.id });
  replaceCandidate.value = plan;
  isReplaceOpen.value = true;
};

const confirmReplace = () => {
  if (!replaceCandidate.value || isReplacing.value) return;
  replace({ planId: replaceCandidate.value.id, replace: true });
};

const purgeCandidate = ref<BudgetPlanModel | null>(null);
const isPurgeOpen = ref(false);

const { isPending: isPurging, mutate: purge } = useInvalidatingMutation({
  mutationFn: purgeBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.trashed.purged',
  errorKey: 'budgetPlans.trashed.purgeError',
  onSuccess: () => {
    isPurgeOpen.value = false;
  },
});

const isBusy = computed(() => isRestoring.value || isReplacing.value || isPurging.value);

const askPurge = ({ plan }: { plan: BudgetPlanModel }) => {
  purgeCandidate.value = plan;
  isPurgeOpen.value = true;
};

const confirmPurge = () => {
  if (!purgeCandidate.value || isPurging.value) return;
  purge({ planId: purgeCandidate.value.id });
};

watch(
  () => props.plans.length,
  (count) => {
    if (!count) isOpen.value = false;
  },
);
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('budgetPlans.trashed.title') }}</template>
    <template #description>
      {{ $t('budgetPlans.trashed.description', { days: BUDGET_PLAN_TRASH_RETENTION_DAYS }) }}
    </template>

    <ul class="border-border divide-border divide-y rounded-lg border">
      <li
        v-for="{ plan, cadence, deletedOn, daysLeft, isRestorable } in rows"
        :key="plan.id"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
      >
        <div class="min-w-0 flex-[1_1_10rem]">
          <p class="truncate font-medium">{{ plan.name }}</p>
          <p class="text-muted-foreground text-xs">
            {{ $t(cadence.key, cadence.params) }} · {{ $t('budgetPlans.trashed.deletedOn', { date: deletedOn }) }}
          </p>
          <p v-if="!isRestorable" class="text-warning-text mt-1 flex items-start gap-1.5 text-xs">
            <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0" />
            {{
              $t('budgetPlans.trashed.currencyMismatch', {
                planCurrency: plan.currencyCode,
                baseCurrency: baseCurrency?.currencyCode,
              })
            }}
          </p>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <span
            :class="
              cn(
                'text-xs whitespace-nowrap tabular-nums',
                daysLeft <= EXPIRING_SOON_DAYS ? 'text-warning-text' : 'text-muted-foreground',
              )
            "
          >
            {{ $t('budgetPlans.trashed.daysLeft', { n: daysLeft }, daysLeft) }}
          </span>

          <Button
            variant="outline"
            size="sm"
            :disabled="!isRestorable || isBusy"
            :aria-label="$t('budgetPlans.trashed.restorePlan', { name: plan.name })"
            @click="askRestore({ plan })"
          >
            <Loader2Icon
              v-if="(isRestoring && restoring?.planId === plan.id) || (isReplacing && replaceCandidate?.id === plan.id)"
              class="size-4 animate-spin"
            />
            <Undo2Icon v-else class="size-4" />
            {{ $t('budgetPlans.trashed.restore') }}
          </Button>

          <DesktopOnlyTooltip :content="$t('budgetPlans.trashed.purge')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :disabled="isBusy"
              :aria-label="$t('budgetPlans.trashed.purgePlan', { name: plan.name })"
              @click="askPurge({ plan })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </li>
    </ul>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    v-model:open="isReplaceOpen"
    :confirm-label="$t('budgetPlans.trashed.replaceConfirm')"
    :confirm-disabled="isReplacing"
    @confirm="confirmReplace"
  >
    <template #title>{{ $t('budgetPlans.trashed.replaceTitle') }}</template>
    <template #description>
      <i18n-t keypath="budgetPlans.trashed.replaceDescription" tag="span">
        <template #restored>
          <span class="text-foreground font-medium">{{ replaceCandidate?.name }}</span>
        </template>
        <template #current>
          <span class="text-foreground font-medium">{{ activePlan?.name }}</span>
        </template>
      </i18n-t>
    </template>
  </ResponsiveAlertDialog>

  <ResponsiveAlertDialog
    v-model:open="isPurgeOpen"
    :confirm-label="$t('budgetPlans.trashed.purge')"
    confirm-variant="destructive"
    :confirm-disabled="isPurging"
    @confirm="confirmPurge"
  >
    <template #title>{{ $t('budgetPlans.trashed.purgeTitle', { name: purgeCandidate?.name }) }}</template>
    <template #description>{{ $t('budgetPlans.trashed.purgeDescription') }}</template>
  </ResponsiveAlertDialog>
</template>
