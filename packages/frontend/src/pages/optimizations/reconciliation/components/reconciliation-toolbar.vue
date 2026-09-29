<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useAccountsStore } from '@/stores';
import { RECONCILIATION_MERGE_MAX, RECONCILIATION_REMOVE_MAX } from '@bt/shared/const/reconciliation';
import type { RecordId, TransactionModel } from '@bt/shared/types';
import { GitMergeIcon, Trash2Icon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import { getReconciliationBlockReasons } from '../block-reasons';
import MergeDialog from './merge-dialog.vue';
import RemoveDialog from './remove-dialog.vue';

const props = defineProps<{
  selectedIds: string[];
  transactions: TransactionModel[];
}>();
const emit = defineEmits<{ 'clear-selection': [] }>();

const { accountsRecord } = storeToRefs(useAccountsStore());
const blockReasonParams = { mergeMax: RECONCILIATION_MERGE_MAX, removeMax: RECONCILIATION_REMOVE_MAX };

const selectedIdSet = computed(() => new Set(props.selectedIds));
const selectedTransactions = computed(() => props.transactions.filter((tx) => selectedIdSet.value.has(tx.id)));

const isMergeOpen = ref(false);
const isRemoveOpen = ref(false);
const mergeTargets = ref<TransactionModel[]>([]);
const removeTargetIds = ref<RecordId[]>([]);

const openAction = ({ action }: { action: 'merge' | 'remove' }) => {
  if (action === 'merge') {
    mergeTargets.value = selectedTransactions.value;
    isMergeOpen.value = true;
  } else {
    removeTargetIds.value = selectedTransactions.value.map((tx) => tx.id);
    isRemoveOpen.value = true;
  }
};

const actions = computed(() =>
  (['merge', 'remove'] as const).map((action) => ({
    action,
    icon: action === 'merge' ? GitMergeIcon : Trash2Icon,
    variant: action === 'merge' ? ('outline' as const) : ('soft-destructive' as const),
    reasons: getReconciliationBlockReasons({
      action,
      transactions: selectedTransactions.value,
      accountsRecord: accountsRecord.value,
    }),
    open: () => openAction({ action }),
  })),
);
</script>

<template>
  <div class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
    <template v-if="selectedIds.length > 0">
      <span class="text-sm whitespace-nowrap">
        {{
          $t('transactions.bulkEdit.selectedCount', {
            count: selectedIds.length,
          })
        }}
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <template v-for="item in actions" :key="item.action">
          <ResponsiveTooltip v-if="item.reasons.length > 0" content-class-name="max-w-75">
            <span class="inline-flex">
              <Button :variant="item.variant" size="sm" disabled>
                <component :is="item.icon" class="size-4" />
                {{ $t(`optimizations.reconciliation.actions.${item.action}`) }}
              </Button>
            </span>
            <template #content>
              <template v-if="item.reasons.length === 1">
                {{ $t(`optimizations.reconciliation.blockReasons.${item.reasons[0]}`, blockReasonParams) }}
              </template>
              <template v-else>
                <p class="mb-1 font-medium">
                  {{
                    $t(`optimizations.reconciliation.blockReasons.header.${item.action}`, {
                      count: item.reasons.length,
                    })
                  }}
                </p>
                <ul class="list-disc space-y-0.5 pl-4">
                  <li v-for="reason in item.reasons" :key="reason">
                    {{ $t(`optimizations.reconciliation.blockReasons.${reason}`, blockReasonParams) }}
                  </li>
                </ul>
              </template>
            </template>
          </ResponsiveTooltip>
          <Button v-else :variant="item.variant" size="sm" @click="item.open">
            <component :is="item.icon" class="size-4" />
            {{ $t(`optimizations.reconciliation.actions.${item.action}`) }}
          </Button>
        </template>

        <DesktopOnlyTooltip :content="$t('transactions.bulkEdit.cancelSelection')">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="$t('transactions.bulkEdit.cancelSelection')"
            @click="emit('clear-selection')"
          >
            <XIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </template>
    <span v-else class="text-muted-foreground text-sm">{{ $t('optimizations.reconciliation.table.hint') }}</span>

    <MergeDialog v-model:open="isMergeOpen" :transactions="mergeTargets" @merged="emit('clear-selection')" />
    <RemoveDialog v-model:open="isRemoveOpen" :transaction-ids="removeTargetIds" @removed="emit('clear-selection')" />
  </div>
</template>
