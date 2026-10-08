<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { InvestmentImportTransaction } from '@bt/shared/types/investments';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

const TOOLTIP_CLASS = 'max-w-xs';
// Rough first-paint estimates. Real heights come from `measureElement` once
// rows mount — needed because the compact row has variable height (the
// possible-duplicate / delete action bar only renders on rows flagged as
// duplicates).
const COMPACT_ROW_ESTIMATE_PX = 260;
const WIDE_ROW_ESTIMATE_PX = 44;
const MAX_LIST_HEIGHT_PX = 520;

type TransactionSide = InvestmentImportTransaction['side'];

const props = defineProps<{
  transactions: InvestmentImportTransaction[];
  skipTempIds: Set<string>;
  sideOptions: Array<{ value: TransactionSide; label: string }>;
  isTransactionValid: (tx: InvestmentImportTransaction) => boolean;
  /** Switch row layout + height for narrow viewports. */
  compact: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-skip', tempId: string): void;
  (e: 'delete-transaction', tempId: string): void;
}>();

const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.transactions.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => (props.compact ? COMPACT_ROW_ESTIMATE_PX : WIDE_ROW_ESTIMATE_PX),
    overscan: 6,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

function measureRow(el: Element | null) {
  if (el) virtualizer.value.measureElement(el as HTMLElement);
}

function rowBackgroundClasses(tx: InvestmentImportTransaction): string[] {
  const out: string[] = [];
  if (tx.possibleDuplicateOf) {
    out.push(
      props.skipTempIds.has(tx.tempId) ? 'bg-muted/40 opacity-60' : 'bg-warning/10 ring-warning/30 ring-1 ring-inset',
    );
  }
  if (!props.isTransactionValid(tx)) out.push('bg-destructive/5');
  return out;
}
</script>

<template>
  <div class="bg-muted/20 border-t">
    <!-- Wide column headers -->
    <div
      v-if="!compact"
      class="text-muted-foreground grid grid-cols-[110px_110px_1fr_1fr_1fr_1fr_160px] gap-2 px-4 pt-3 pb-1 text-xs font-medium tracking-wider uppercase"
    >
      <div class="text-left">{{ $t('investmentsImport.review.cols.date') }}</div>
      <div class="text-left">{{ $t('investmentsImport.review.cols.side') }}</div>
      <div class="text-right">{{ $t('investmentsImport.review.cols.qty') }}</div>
      <div class="text-right">{{ $t('investmentsImport.review.cols.price') }}</div>
      <div class="text-right">{{ $t('investmentsImport.review.cols.fees') }}</div>
      <div class="text-right">{{ $t('investmentsImport.review.cols.amount') }}</div>
      <div></div>
    </div>

    <div ref="scrollRef" class="relative overflow-y-auto px-2 pb-3" :style="{ maxHeight: `${MAX_LIST_HEIGHT_PX}px` }">
      <div :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
        <div
          v-for="virtualRow in virtualRows"
          :key="transactions[virtualRow.index]!.tempId"
          :ref="(el) => measureRow(el as Element | null)"
          :data-index="virtualRow.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
            padding: '4px 0',
          }"
        >
          <!-- Wide row -->
          <div
            v-if="!compact"
            :class="[
              'grid grid-cols-[110px_110px_1fr_1fr_1fr_1fr_160px] items-center gap-2 rounded-md px-2 py-1.5',
              ...rowBackgroundClasses(transactions[virtualRow.index]!),
            ]"
          >
            <InputField
              v-model="transactions[virtualRow.index]!.date"
              type="date"
              class="[&_input]:h-8 [&_input]:px-2 [&_input]:text-sm"
            />
            <SelectField
              :model-value="sideOptions.find((o) => o.value === transactions[virtualRow.index]!.side) ?? null"
              :values="sideOptions"
              class="[&_button]:h-8 [&_button]:text-sm"
              @update:model-value="(opt) => opt && (transactions[virtualRow.index]!.side = opt.value)"
            />
            <InputField
              v-model="transactions[virtualRow.index]!.quantity"
              type="text"
              inputmode="decimal"
              class="[&_input]:h-8 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
            />
            <InputField
              v-model="transactions[virtualRow.index]!.price"
              type="text"
              inputmode="decimal"
              class="[&_input]:h-8 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
            />
            <InputField
              v-model="transactions[virtualRow.index]!.fees"
              type="text"
              inputmode="decimal"
              class="[&_input]:h-8 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
            />
            <div class="text-right text-sm tabular-nums">
              {{ Number(transactions[virtualRow.index]!.amount).toFixed(2) }}
            </div>
            <div class="flex items-center justify-end gap-1.5">
              <DesktopOnlyTooltip
                v-if="transactions[virtualRow.index]!.possibleDuplicateOf"
                :content="$t('investmentsImport.review.duplicateBadgeTooltip')"
                :content-class-name="TOOLTIP_CLASS"
              >
                <Button
                  type="button"
                  size="sm"
                  :variant="skipTempIds.has(transactions[virtualRow.index]!.tempId) ? 'secondary' : 'soft-destructive'"
                  class="h-7 gap-1 px-2 text-xs"
                  @click="emit('toggle-skip', transactions[virtualRow.index]!.tempId)"
                >
                  <TriangleAlertIcon class="size-3.5" />
                  {{
                    skipTempIds.has(transactions[virtualRow.index]!.tempId)
                      ? $t('investmentsImport.review.skipping')
                      : $t('investmentsImport.review.possibleDup')
                  }}
                </Button>
              </DesktopOnlyTooltip>
              <DesktopOnlyTooltip :content="$t('investmentsImport.review.deleteTransaction')">
                <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  @click="emit('delete-transaction', transactions[virtualRow.index]!.tempId)"
                >
                  <Trash2Icon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </div>
          </div>

          <!-- Compact (mobile) row: stacked card -->
          <div
            v-else
            :class="[
              'grid grid-cols-2 gap-2 rounded-md border p-3 text-sm',
              ...rowBackgroundClasses(transactions[virtualRow.index]!),
            ]"
          >
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.date') }}</label>
              <InputField
                v-model="transactions[virtualRow.index]!.date"
                type="date"
                class="[&_input]:h-9 [&_input]:px-2 [&_input]:text-sm"
              />
            </div>
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.side') }}</label>
              <SelectField
                :model-value="sideOptions.find((o) => o.value === transactions[virtualRow.index]!.side) ?? null"
                :values="sideOptions"
                class="[&_button]:h-9 [&_button]:text-sm"
                @update:model-value="(opt) => opt && (transactions[virtualRow.index]!.side = opt.value)"
              />
            </div>
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.qty') }}</label>
              <InputField
                v-model="transactions[virtualRow.index]!.quantity"
                type="text"
                inputmode="decimal"
                class="[&_input]:h-9 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
              />
            </div>
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.price') }}</label>
              <InputField
                v-model="transactions[virtualRow.index]!.price"
                type="text"
                inputmode="decimal"
                class="[&_input]:h-9 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
              />
            </div>
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.fees') }}</label>
              <InputField
                v-model="transactions[virtualRow.index]!.fees"
                type="text"
                inputmode="decimal"
                class="[&_input]:h-9 [&_input]:px-2 [&_input]:text-right [&_input]:text-sm"
              />
            </div>
            <div>
              <label class="text-muted-foreground text-xs">{{ $t('investmentsImport.review.cols.amount') }}</label>
              <div class="flex h-9 items-center justify-end pr-2 text-sm font-medium tabular-nums">
                {{ Number(transactions[virtualRow.index]!.amount).toFixed(2) }}
              </div>
            </div>
            <div class="col-span-2 flex items-center justify-between gap-2">
              <DesktopOnlyTooltip
                v-if="transactions[virtualRow.index]!.possibleDuplicateOf"
                :content="$t('investmentsImport.review.duplicateBadgeTooltip')"
                :content-class-name="TOOLTIP_CLASS"
              >
                <Button
                  type="button"
                  size="sm"
                  :variant="skipTempIds.has(transactions[virtualRow.index]!.tempId) ? 'secondary' : 'soft-destructive'"
                  class="h-8 gap-1 text-xs"
                  @click="emit('toggle-skip', transactions[virtualRow.index]!.tempId)"
                >
                  <TriangleAlertIcon class="size-3.5" />
                  {{
                    skipTempIds.has(transactions[virtualRow.index]!.tempId)
                      ? $t('investmentsImport.review.skipping')
                      : $t('investmentsImport.review.possibleDup')
                  }}
                </Button>
              </DesktopOnlyTooltip>
              <span v-else></span>
              <DesktopOnlyTooltip :content="$t('investmentsImport.review.deleteTransaction')">
                <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  @click="emit('delete-transaction', transactions[virtualRow.index]!.tempId)"
                >
                  <Trash2Icon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
