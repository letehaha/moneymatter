<template>
  <!-- Borders live on cells, not the row: the table uses border-separate, where <tr> borders don't render -->
  <tr
    :class="['group/row hover:bg-muted/50 h-10 cursor-pointer divide-x transition-colors', isPlannedRow && 'bg-muted']"
    aria-haspopup="true"
    :data-index="index"
    @click="emitRecordClick"
  >
    <!-- Selection checkbox (sticky so it survives horizontal scroll) -->
    <!-- Arbitrary property, not border-dashed: the cell's border-b must stay solid. -->
    <td
      :class="[
        'sticky left-0 z-1 w-8 border-b px-1',
        isPlannedRow ? 'bg-muted border-l-primary/60 border-l-2 [border-left-style:dashed]' : 'bg-card',
      ]"
      @click.stop
    >
      <div class="flex flex-col items-center justify-center gap-0.5">
        <label class="flex items-center justify-center">
          <Checkbox v-if="isSelectable" :model-value="isSelected" @update:model-value="onSelectionChange" />
          <ResponsiveTooltip
            v-else-if="unselectableReason"
            :delay-duration="100"
            :content="$t(`common.transactions.record.unselectableReasons.${unselectableReason}`)"
            content-class-name="max-w-56"
          >
            <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
          </ResponsiveTooltip>
          <div v-else class="size-4" />
        </label>

        <PlannedIndicator compact hide-confirmed :transaction="tx" />
      </div>
    </td>

    <!-- Edit/bank/managed cells take the click; details and n/a cells fall through to the row's click.
         mousedown is cancelled so a mouse click doesn't focus-scroll the cell, which closes the editor. -->
    <td
      v-for="column in visibleColumns"
      :key="column.id"
      :data-inline-cell="inlineCellKey({ txId: tx.id, column: column.id })"
      :tabindex="isCellClaimed({ column: column.id }) ? 0 : undefined"
      :class="
        cn(
          'group/cell relative overflow-hidden border-b px-3 text-sm whitespace-nowrap transition-colors duration-700',
          column.align === 'right' && 'text-right',
          CELL_MODE_CLASSES[modeOf({ column: column.id })],
          editingColumn === column.id &&
            'bg-card inset-ring-primary hover:inset-ring-primary inset-ring-2 duration-0 hover:inset-ring-2',
          cellStateOf({ column: column.id }) === 'pending' && '*:opacity-50',
          cellStateOf({ column: column.id }) === 'saved' && 'bg-primary/15 duration-0',
        )
      "
      @mousedown="isCellClaimed({ column: column.id }) && $event.preventDefault()"
      @click="onCellClick({ column: column.id, event: $event })"
      @keydown.enter.self="onCellClick({ column: column.id, event: $event })"
    >
      <!-- Date -->
      <template v-if="column.id === TABLE_COLUMN.date">
        <span class="text-muted-foreground tabular-nums">{{ formattedDate }}</span>
      </template>

      <!-- Account -->
      <template v-else-if="column.id === TABLE_COLUMN.account">
        <div class="flex items-center gap-1.5">
          <AccountLogo v-if="accountFrom" :account="accountFrom" class="size-5 shrink-0" />
          <span class="max-w-36 truncate">{{ accountFrom?.name }}</span>
          <template v-if="isTwoLegTransferRow">
            <ArrowRightIcon :size="13" class="shrink-0 opacity-60" />
            <AccountLogo
              v-if="transferDestinationAccount"
              :account="transferDestinationAccount"
              class="size-5 shrink-0"
            />
            <span class="max-w-36 truncate">{{ transferDestinationName }}</span>
          </template>
          <template v-else-if="isOutOfWalletTransfer">
            <ArrowRightIcon :size="13" class="shrink-0 opacity-60" />
            <span class="text-muted-foreground">{{ $t('transactions.table.outOfWallet') }}</span>
          </template>
          <template v-else-if="isPortfolioLinked">
            <ArrowRightIcon :size="13" class="shrink-0 opacity-60" />
            <BriefcaseIcon :size="13" class="text-app-transfer-color shrink-0" />
            <span class="max-w-36 truncate">{{ portfolioName }}</span>
          </template>
        </div>
      </template>

      <!-- Category -->
      <template v-else-if="column.id === TABLE_COLUMN.category">
        <div class="flex items-center gap-2">
          <template v-if="!isTransferRow && category">
            <CategoryCircle :category="category" />
            <span class="max-w-32 truncate">{{ category.name }}</span>
          </template>
          <span v-else class="text-muted-foreground">—</span>
          <AttachmentIndicator :transaction="tx" />
        </div>
      </template>

      <!-- Payee -->
      <template v-else-if="column.id === TABLE_COLUMN.payee">
        <div v-if="payee" class="flex items-center gap-2">
          <BrandLogo
            :domain="payee.logoDomain"
            :initials="payee.logoInitials"
            :color="payee.logoColor"
            :name="payee.name"
            class="size-5 shrink-0"
          />
          <DesktopOnlyTooltip :content="payee.name" only-when-truncated>
            <span class="max-w-32 truncate">{{ payee.name }}</span>
          </DesktopOnlyTooltip>
        </div>
        <span v-else class="text-muted-foreground">—</span>
      </template>

      <!-- Amount (original currency) -->
      <template v-else-if="column.id === TABLE_COLUMN.amount">
        <span :class="['text-amount tabular-nums', amountColorClass]">{{ formattedAmount }}</span>
      </template>

      <!-- Ref amount (base currency) -->
      <template v-else-if="column.id === TABLE_COLUMN.refAmount">
        <span :class="['text-amount tabular-nums', amountColorClass]">{{ formattedRefAmount }}</span>
      </template>

      <!-- Original amount (foreign currency the user paid in) -->
      <template v-else-if="column.id === TABLE_COLUMN.originalAmount">
        <span v-if="formattedOriginalAmount" class="text-amount text-muted-foreground tabular-nums">
          {{ formattedOriginalAmount }}
        </span>
      </template>

      <!-- Note -->
      <template v-else-if="column.id === TABLE_COLUMN.note">
        <DesktopOnlyTooltip v-if="tx.note" :content="tx.note">
          <span class="text-muted-foreground block max-w-40 truncate">{{ tx.note }}</span>
        </DesktopOnlyTooltip>
      </template>

      <!-- Tags -->
      <template v-else-if="column.id === TABLE_COLUMN.tags">
        <DesktopOnlyTooltip v-if="txTags.length" :disabled="txTags.length <= 1">
          <div class="flex items-center gap-1">
            <span
              class="inline-block max-w-37.5 truncate rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
              :style="{ backgroundColor: txTags[0]!.color }"
            >
              {{ txTags[0]!.name }}
            </span>
            <span v-if="hiddenTagsCount > 0" class="text-muted-foreground text-xs">+{{ hiddenTagsCount }}</span>
          </div>
          <template #content>
            <ScrollArea class="max-h-75">
              <div class="flex flex-col items-start gap-1 pr-2">
                <span
                  v-for="tag in txTags"
                  :key="tag.id"
                  class="inline-block max-w-37.5 truncate rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
                  :style="{ backgroundColor: tag.color }"
                >
                  {{ tag.name }}
                </span>
              </div>
            </ScrollArea>
          </template>
        </DesktopOnlyTooltip>
      </template>

      <!-- Categorization source -->
      <template v-else-if="column.id === TABLE_COLUMN.categorizationSource">
        <span v-if="categorizationSourceLabel" class="text-muted-foreground text-xs">
          {{ categorizationSourceLabel }}
        </span>
      </template>

      <!-- Group -->
      <template v-else-if="column.id === TABLE_COLUMN.group">
        <span v-if="groupName" class="max-w-32 truncate">{{ groupName }}</span>
      </template>

      <!-- Refund indicator -->
      <template v-else-if="column.id === TABLE_COLUMN.refundIndicator">
        <RefundIndicator :transaction="tx" />
      </template>

      <!-- Split indicator -->
      <template v-else-if="column.id === TABLE_COLUMN.splitIndicator">
        <SplitIndicator :transaction="tx" />
      </template>

      <Loader2Icon
        v-if="cellStateOf({ column: column.id }) === 'pending'"
        :class="[
          'text-primary-text absolute top-1/2 size-3.5 -translate-y-1/2 animate-spin opacity-100!',
          column.align === 'right' ? 'left-2' : 'right-2',
        ]"
      />
      <span
        v-else-if="modeOf({ column: column.id }) !== 'na'"
        aria-hidden="true"
        :class="[
          'bg-card text-muted-foreground absolute top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md border opacity-0 transition-opacity group-hover/row:opacity-100',
          column.align === 'right' ? 'left-1.5' : 'right-1.5',
          GLYPH_CLASSES[modeOf({ column: column.id })],
        ]"
      >
        <component :is="GLYPH_ICONS[modeOf({ column: column.id })]" class="size-3.5" />
      </span>
    </td>

    <td :class="['sticky right-0 z-1 border-b px-1 text-center', isPlannedRow ? 'bg-muted' : 'bg-card']">
      <DesktopOnlyTooltip :content="$t('transactions.inlineEdit.openDetails')">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('transactions.inlineEdit.openDetails')"
          @click.stop="emitRecordClick"
        >
          <SquareArrowOutUpRightIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </td>
  </tr>
</template>

<script lang="ts" setup>
import AccountLogo from '@/components/common/account-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import AttachmentIndicator from '@/components/transactions-list/indicators/attachment-indicator.vue';
import PlannedIndicator from '@/components/transactions-list/indicators/planned-indicator.vue';
import RefundIndicator from '@/components/transactions-list/indicators/refund-indicator.vue';
import SplitIndicator from '@/components/transactions-list/indicators/split-indicator.vue';
import { useOppositeTxRecord } from '@/composable/data-queries/opposite-tx-record';
import type { BulkUnselectableReason } from '@/composable/transaction-selection';
import { useTransactionPortfolioLink } from '@/composable/data-queries/portfolio-transfers';
import { useFormatCurrency } from '@/composable/formatters';
import { useAccountAccess } from '@/composable/use-account-access';
import { formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCategoriesStore, useUserStore } from '@/stores';
import {
  CATEGORIZATION_SOURCE,
  isTwoLegTransfer,
  PayeeLookupItem,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
} from '@bt/shared/types';
import {
  ArrowRightIcon,
  BriefcaseIcon,
  InfoIcon,
  LandmarkIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
} from '@lucide/vue';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { type Component, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { type ColumnDefinition, TABLE_COLUMN } from './columns';
import {
  type ClaimedCellMode,
  type InlineCellMode,
  type InlineEditableColumn,
  getInlineCellMode,
  isClaimedCellMode,
  isInlineEditableColumn,
} from './inline-cell-mode';
import { type InlineCellSaveState, inlineCellKey } from './use-inline-transaction-edit';

const MAX_VISIBLE_TAGS = 1;

const CELL_MODE_CLASSES: Record<InlineCellMode, string> = {
  edit: 'cursor-text hover:inset-ring hover:inset-ring-ring touch:active:bg-accent touch:active:duration-0',
  bank: 'cursor-help group-hover/row:bg-hatched-dense locks-visible:bg-hatched-dense',
  managed: 'cursor-help group-hover/row:bg-hatched-dense locks-visible:bg-hatched-dense',
  details:
    'group-hover/row:inset-ring group-hover/row:inset-ring-border locks-visible:outline locks-visible:outline-dotted locks-visible:-outline-offset-4 locks-visible:outline-muted-foreground',
  na: '',
};

const GLYPH_ICONS: Record<InlineCellMode, Component | undefined> = {
  edit: PencilIcon,
  bank: LandmarkIcon,
  managed: LockIcon,
  details: SquareArrowOutUpRightIcon,
  na: undefined,
};

const GLYPH_CLASSES: Record<InlineCellMode, string> = {
  edit: 'group-hover/cell:text-primary-text group-hover/cell:border-ring',
  bank: 'border-dashed',
  managed: 'border-dashed',
  details: 'border-dotted',
  na: '',
};

const props = defineProps<{
  tx: TransactionModel;
  visibleColumns: ColumnDefinition[];
  index: number;
  isSelected: boolean;
  isSelectable: boolean;
  /** Shown as an explainer tooltip in place of the checkbox when not selectable. */
  unselectableReason?: BulkUnselectableReason | null;
  /** Resolved payee (name + logo fields) for the beneficiary cell; undefined for transfers/unassigned. */
  payee: PayeeLookupItem | undefined;
  cellStates: Map<string, InlineCellSaveState>;
  editingColumn: TABLE_COLUMN | null;
}>();

const emit = defineEmits<{
  'record-click': [[value: TransactionModel, oppositeTx: TransactionModel | undefined]];
  'selection-change': [{ value: boolean; id: string; index: number }];
  'cell-click': [
    {
      tx: TransactionModel;
      oppositeTx: TransactionModel | undefined;
      column: InlineEditableColumn;
      mode: ClaimedCellMode;
    },
  ];
}>();

const { t, te } = useI18n();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { accountsRecord } = storeToRefs(useAccountsStore());
const { formatBaseCurrency } = useFormatCurrency();
const { user } = storeToRefs(useUserStore());

const isTwoLegTransferRow = computed(() => isTwoLegTransfer(props.tx.transferNature));
const isOutOfWalletTransfer = computed(
  () => props.tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
);
const isPortfolioLinked = computed(() => props.tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio);
const isTransferRow = computed(
  () => isTwoLegTransferRow.value || isOutOfWalletTransfer.value || isPortfolioLinked.value,
);
const isPlannedRow = computed(() => props.tx.isPlanned);

const { data: oppositeTx } = useOppositeTxRecord(() => props.tx);

const portfolioLinkId = computed(() => (isPortfolioLinked.value ? props.tx.id : undefined));
const { data: portfolioLinkData } = useTransactionPortfolioLink(portfolioLinkId);
const portfolioName = computed(() => portfolioLinkData.value?.portfolioName ?? '');

const category = computed(() => categoriesMap.value[props.tx.categoryId]);
const accountFrom = computed(() => accountsRecord.value[props.tx.accountId]);
const transferDestinationAccount = computed(() =>
  oppositeTx.value ? accountsRecord.value[oppositeTx.value.accountId] : undefined,
);
const transferDestinationName = computed(
  () => transferDestinationAccount.value?.name ?? t('common.transactions.record.hiddenAccount'),
);

const formattedDate = computed(() => format(new Date(props.tx.time), 'd MMM y'));

const amountColorClass = computed(() => {
  if (isTwoLegTransferRow.value) return 'text-app-transfer-color';
  if (props.tx.transactionType === TRANSACTION_TYPES.income) return 'text-app-income-color';
  return 'text-app-expense-color';
});

const signedAmount = (amount: number) => (props.tx.transactionType === TRANSACTION_TYPES.expense ? -amount : amount);

const formattedAmount = computed(() =>
  formatUIAmount(signedAmount(props.tx.amount), { currency: props.tx.currencyCode }),
);
const formattedRefAmount = computed(() => formatBaseCurrency(signedAmount(props.tx.refAmount)));

const formattedOriginalAmount = computed(() => {
  const { originalAmount, originalCurrencyCode } = props.tx;
  if (originalAmount == null || !originalCurrencyCode) return '';
  return formatUIAmount(originalAmount, { currency: originalCurrencyCode });
});

const txTags = computed(() => props.tx.tags ?? []);
const hiddenTagsCount = computed(() => Math.max(0, txTags.value.length - MAX_VISIBLE_TAGS));

const groupName = computed(() => props.tx.transactionGroups?.[0]?.name);

const categorizationSourceLabel = computed(() => {
  const source = props.tx.categorizationMeta?.source as CATEGORIZATION_SOURCE | undefined;
  if (!source) return undefined;
  const key = `transactions.table.categorizationSourceValues.${source}`;
  return te(key) ? t(key) : source;
});

const { canMutateTx } = useAccountAccess(accountFrom);
const canEdit = computed(() => canMutateTx(props.tx, user.value?.id));

const cellModes = computed<Partial<Record<TABLE_COLUMN, InlineCellMode>>>(() =>
  Object.fromEntries(
    props.visibleColumns.map((column) => [
      column.id,
      getInlineCellMode({
        tx: props.tx,
        column: column.id,
        account: accountFrom.value,
        oppositeAccount: transferDestinationAccount.value,
        canEdit: canEdit.value,
      }),
    ]),
  ),
);

const modeOf = ({ column }: { column: TABLE_COLUMN }) => cellModes.value[column] ?? 'na';

const isCellClaimed = ({ column }: { column: TABLE_COLUMN }) => isClaimedCellMode(modeOf({ column }));

const cellStateOf = ({ column }: { column: TABLE_COLUMN }) =>
  props.cellStates.get(inlineCellKey({ txId: props.tx.id, column }));

const onCellClick = ({ column, event }: { column: TABLE_COLUMN; event: Event }) => {
  const mode = modeOf({ column });
  if (!isClaimedCellMode(mode) || !isInlineEditableColumn(column)) return;
  event.stopPropagation();
  if (cellStateOf({ column }) === 'pending') return;
  if (props.editingColumn === column && (event as MouseEvent).detail > 1) return;
  emit('cell-click', { tx: props.tx, oppositeTx: oppositeTx.value ?? undefined, column, mode });
};

const emitRecordClick = () => {
  emit('record-click', [props.tx, oppositeTx.value ?? undefined]);
};

const onSelectionChange = (value: boolean | 'indeterminate') => {
  emit('selection-change', { value: value === true, id: props.tx.id, index: props.index });
};
</script>
