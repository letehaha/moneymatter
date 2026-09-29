<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDateLocale } from '@/composable/use-date-locale';
import { formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type RecordId, type TransactionModel } from '@bt/shared/types';
import type { StuckPendingItem } from '@bt/shared/types/endpoints';
import {
  CircleCheckIcon,
  ClockIcon,
  GitMergeIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useReconciliationActions, useStuckPending } from '../use-reconciliation';
import MergeDialog from './merge-dialog.vue';
import RemoveDialog from './remove-dialog.vue';
import StuckPendingStatus from './stuck-pending-status.vue';

defineProps<{ isMobileMode: boolean }>();

const SKELETON_ROW_COUNT = 4;
const SHORT_DATE_FORMAT = 'd MMM';
const I18N = 'optimizations.reconciliation.stuckPending';

const { data, isFetched, isError, refetch } = useStuckPending();
const { keepBooked, checkWithBank } = useReconciliationActions();
const { accountsRecord } = storeToRefs(useAccountsStore());
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { format } = useDateLocale();
const { t } = useI18n();

const items = computed(() => data.value ?? []);
const accountCount = computed(() => new Set(items.value.map((item) => item.transaction.accountId)).size);
const checkableAccountIds = computed(() => [
  ...new Set(items.value.filter((item) => item.canCheckWithBank).map((item) => item.transaction.accountId)),
]);
const maxPendingDays = computed(() => Math.max(1, ...items.value.map((item) => item.pendingDays)));

const hasChecked = ref(false);
const isResolvable = computed(() => hasChecked.value || checkableAccountIds.value.length === 0);

const checkAll = () =>
  checkWithBank.mutate({ accountIds: checkableAccountIds.value }, { onSuccess: () => (hasChecked.value = true) });

const showCheckedCopy = computed(() => hasChecked.value && !checkWithBank.isError.value);

const headerTitle = computed(() =>
  t(
    showCheckedCopy.value ? `${I18N}.header.titleChecked` : `${I18N}.header.title`,
    { count: items.value.length },
    items.value.length,
  ),
);

const headerDescription = computed(() => {
  if (showCheckedCopy.value) return t(`${I18N}.header.descriptionChecked`);
  if (!checkableAccountIds.value.length) {
    return t(`${I18N}.summaryTooOld`, { count: items.value.length }, items.value.length);
  }
  return t(`${I18N}.header.description`, { count: accountCount.value }, accountCount.value);
});

const accountNameOf = ({ tx }: { tx: TransactionModel }) => accountsRecord.value[tx.accountId]?.name ?? '';
const categoryOf = ({ tx }: { tx: TransactionModel }) => categoriesMap.value[tx.categoryId];

const isIncome = ({ tx }: { tx: TransactionModel }) => tx.transactionType === TRANSACTION_TYPES.income;
const amountOf = ({ tx }: { tx: TransactionModel }) =>
  formatUIAmount(isIncome({ tx }) ? tx.amount : -tx.amount, { currency: tx.currencyCode });
const amountClass = ({ tx }: { tx: TransactionModel }) =>
  cn(
    'text-amount tabular-nums whitespace-nowrap',
    isIncome({ tx }) ? 'text-app-income-color' : 'text-app-expense-color',
  );

const pendingBarWidth = ({ item }: { item: StuckPendingItem }) => `${(item.pendingDays / maxPendingDays.value) * 100}%`;

const isKeepingRow = ({ id }: { id: RecordId }) =>
  keepBooked.isPending.value && !!keepBooked.variables.value?.transactionIds.includes(id);

const removeTargetIds = ref<RecordId[]>([]);
const isRemoveOpen = ref(false);
const openRemove = ({ id }: { id: RecordId }) => {
  removeTargetIds.value = [id];
  isRemoveOpen.value = true;
};

const mergeTargets = ref<TransactionModel[]>([]);
const mergeSurvivorId = ref<RecordId>();
const isMergeOpen = ref(false);
const openMerge = ({ item }: { item: StuckPendingItem }) => {
  if (!item.candidate) return;
  mergeTargets.value = [item.transaction, item.candidate];
  mergeSurvivorId.value = item.candidate.id;
  isMergeOpen.value = true;
};
</script>

<template>
  <div class="flex min-h-0 w-full max-w-5xl flex-1 flex-col">
    <Card v-if="isError" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <TriangleAlertIcon class="text-destructive-text size-8" />
      <p class="text-destructive-text text-sm">{{ $t(`${I18N}.loadError`) }}</p>
      <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
    </Card>

    <Card v-else-if="!isFetched" class="flex flex-col gap-2 p-3">
      <div v-for="index in SKELETON_ROW_COUNT" :key="index" class="bg-muted h-12 animate-pulse rounded-md" />
    </Card>

    <Card v-else-if="items.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <CircleCheckIcon class="text-success-text size-6" />
      </div>
      <p class="font-medium">{{ $t(`${I18N}.emptyTitle`) }}</p>
      <p class="text-muted-foreground max-w-sm text-sm">{{ $t(`${I18N}.emptyDescription`) }}</p>
    </Card>

    <ScrollArea v-else class="min-h-0 flex-1">
      <div class="flex flex-col gap-2.5">
        <Card class="overflow-hidden">
          <div
            :class="
              cn(
                'flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-4',
                isMobileMode && 'flex-col items-stretch',
              )
            "
          >
            <div class="grid min-w-0 gap-0.5">
              <h3 class="font-semibold">{{ headerTitle }}</h3>
              <p class="text-muted-foreground text-sm">
                {{ headerDescription }}
              </p>
            </div>
            <Button
              v-if="checkableAccountIds.length"
              :variant="hasChecked ? 'outline' : 'default'"
              :disabled="checkWithBank.isPending.value"
              @click="checkAll"
            >
              <RefreshCwIcon :class="cn('size-4', checkWithBank.isPending.value && 'animate-spin')" />
              <template v-if="checkWithBank.isPending.value">{{ $t(`${I18N}.checking`) }}</template>
              <template v-else-if="hasChecked">{{ $t(`${I18N}.checkAgain`) }}</template>
              <template v-else>{{ $t(`${I18N}.checkWithBank`) }}</template>
            </Button>
          </div>

          <p
            v-if="!isResolvable"
            class="bg-primary/10 text-muted-foreground flex items-center gap-2 border-t px-4 py-2.5 text-xs"
          >
            <LockIcon class="size-3.5 shrink-0" />
            {{ $t(`${I18N}.checkFirstHint`) }}
          </p>

          <ScrollArea v-if="!isMobileMode" class="border-t" with-horizontal-scrollbar>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-muted-foreground border-b text-left text-xs">
                  <th class="px-4 py-2.5 font-medium">{{ $t(`${I18N}.columns.account`) }}</th>
                  <th class="px-4 py-2.5 font-medium">{{ $t(`${I18N}.columns.date`) }}</th>
                  <th class="px-4 py-2.5 font-medium">{{ $t(`${I18N}.columns.category`) }}</th>
                  <th class="px-4 py-2.5 font-medium">{{ $t(`${I18N}.columns.pendingFor`) }}</th>
                  <th class="px-4 py-2.5 text-right font-medium">{{ $t(`${I18N}.columns.amount`) }}</th>
                  <template v-if="isResolvable">
                    <th class="px-4 py-2.5 font-medium">{{ $t(`${I18N}.columns.status`) }}</th>
                    <th class="px-4 py-2.5">
                      <span class="sr-only">{{ $t(`${I18N}.columns.actions`) }}</span>
                    </th>
                  </template>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="item.transaction.id" class="border-b last:border-b-0">
                  <td class="px-4 py-2.5 font-medium whitespace-nowrap">
                    {{ accountNameOf({ tx: item.transaction }) }}
                  </td>
                  <td class="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                    {{ format(item.transaction.time, SHORT_DATE_FORMAT) }}
                  </td>
                  <td class="text-muted-foreground px-4 py-2.5">
                    <span v-if="categoryOf({ tx: item.transaction })" class="inline-flex items-center gap-1.5">
                      <span
                        class="size-2 shrink-0 rounded-full"
                        :style="{ backgroundColor: categoryOf({ tx: item.transaction })!.color }"
                      />
                      {{ categoryOf({ tx: item.transaction })!.name }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5">
                    <div class="text-muted-foreground flex items-center gap-2 text-xs whitespace-nowrap tabular-nums">
                      <span class="bg-muted h-1.5 w-14 shrink-0 overflow-hidden rounded-full">
                        <span
                          class="bg-warning-text block h-full rounded-full"
                          :style="{ width: pendingBarWidth({ item }) }"
                        />
                      </span>
                      {{ $t(`${I18N}.pendingDaysShort`, { count: item.pendingDays }) }}
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <span :class="amountClass({ tx: item.transaction })">{{ amountOf({ tx: item.transaction }) }}</span>
                  </td>
                  <template v-if="isResolvable">
                    <td class="px-4 py-2.5">
                      <StuckPendingStatus :item="item" />
                    </td>
                    <td class="px-4 py-2">
                      <div class="flex items-center justify-end gap-1">
                        <Button v-if="item.candidate" variant="soft-primary" size="sm" @click="openMerge({ item })">
                          <GitMergeIcon class="size-4" />
                          {{ $t('optimizations.reconciliation.actions.merge') }}
                        </Button>
                        <template v-else>
                          <Button
                            variant="outline"
                            size="sm"
                            :disabled="keepBooked.isPending.value"
                            @click="keepBooked.mutate({ transactionIds: [item.transaction.id] })"
                          >
                            <Loader2Icon v-if="isKeepingRow({ id: item.transaction.id })" class="size-4 animate-spin" />
                            {{ $t(`${I18N}.keepAsBooked`) }}
                          </Button>
                          <DesktopOnlyTooltip :content="$t('optimizations.reconciliation.actions.remove')">
                            <Button
                              variant="ghost-destructive"
                              size="icon-sm"
                              :aria-label="$t('optimizations.reconciliation.actions.remove')"
                              @click="openRemove({ id: item.transaction.id })"
                            >
                              <Trash2Icon class="size-4" />
                            </Button>
                          </DesktopOnlyTooltip>
                        </template>
                      </div>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </ScrollArea>
        </Card>

        <template v-if="isMobileMode">
          <Card v-for="item in items" :key="item.transaction.id" class="flex flex-col gap-1.5 p-3.5">
            <div class="flex items-baseline justify-between gap-3">
              <span class="truncate font-semibold">{{ accountNameOf({ tx: item.transaction }) }}</span>
              <span :class="amountClass({ tx: item.transaction })">{{ amountOf({ tx: item.transaction }) }}</span>
            </div>
            <div class="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <span>{{ format(item.transaction.time, SHORT_DATE_FORMAT) }}</span>
              <span v-if="categoryOf({ tx: item.transaction })" class="inline-flex items-center gap-1.5">
                <span
                  class="size-2 rounded-full"
                  :style="{ backgroundColor: categoryOf({ tx: item.transaction })!.color }"
                />
                {{ categoryOf({ tx: item.transaction })!.name }}
              </span>
              <span
                class="bg-warning-text/10 text-warning-text inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold tabular-nums"
              >
                <ClockIcon class="size-3" />
                {{ $t(`${I18N}.pendingDaysShort`, { count: item.pendingDays }) }}
              </span>
            </div>
            <div v-if="isResolvable" class="border-border/60 mt-1.5 flex flex-col gap-2 border-t pt-2.5">
              <StuckPendingStatus :item="item" />
              <Button v-if="item.candidate" variant="soft-primary" size="sm" @click="openMerge({ item })">
                <GitMergeIcon class="size-4" />
                {{ $t('optimizations.reconciliation.actions.merge') }}
              </Button>
              <div v-else class="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="keepBooked.isPending.value"
                  @click="keepBooked.mutate({ transactionIds: [item.transaction.id] })"
                >
                  <Loader2Icon v-if="isKeepingRow({ id: item.transaction.id })" class="size-4 animate-spin" />
                  {{ $t(`${I18N}.keepAsBooked`) }}
                </Button>
                <Button variant="ghost-destructive" size="sm" @click="openRemove({ id: item.transaction.id })">
                  <Trash2Icon class="size-4" />
                  {{ $t('optimizations.reconciliation.actions.remove') }}
                </Button>
              </div>
            </div>
          </Card>
        </template>
      </div>
    </ScrollArea>

    <MergeDialog v-model:open="isMergeOpen" :transactions="mergeTargets" :default-survivor-id="mergeSurvivorId" />
    <RemoveDialog v-model:open="isRemoveOpen" :transaction-ids="removeTargetIds" />
  </div>
</template>
