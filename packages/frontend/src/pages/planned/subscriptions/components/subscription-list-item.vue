<script setup lang="ts">
import type { SubscriptionListItem } from '@/api/subscriptions';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { CheckIcon, CirclePauseIcon, MoreHorizontalIcon, RepeatIcon, Trash2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import LinkedTransactionsBadge from './linked-transactions-badge.vue';
import SubscriptionTypeBadge from './subscription-type-badge.vue';
import { daysUntilDue, isSubscriptionOverdue } from '../subscription-due-status';
import { formatFrequency, getTransactionTypePrefix, getTransactionTypeStyles } from '../utils';

const props = defineProps<{
  subscription: SubscriptionListItem;
  isMarkingPaid: boolean;
  now: Date;
}>();

const emit = defineEmits<{
  select: [subscription: SubscriptionListItem];
  'select-linked': [subscription: SubscriptionListItem];
  pay: [subscription: SubscriptionListItem];
  'toggle-active': [subscription: SubscriptionListItem];
  delete: [subscription: SubscriptionListItem];
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const formattedAmount = computed<string | null>(() => {
  const { expectedAmount, expectedCurrencyCode } = props.subscription;
  if (!expectedAmount || !expectedCurrencyCode) return null;
  return formatAmountByCurrencyCode(expectedAmount, expectedCurrencyCode);
});

// A finished installment (completedAt set) reads as "Completed", distinct from a
// manually paused subscription. Both carry isActive=false.
const isCompleted = computed<boolean>(() => props.subscription.completedAt != null);

/** Paid-vs-total progress for any capped plan (maxOccurrences set); null otherwise. */
const installmentProgress = computed<{ paid: number; total: number } | null>(() => {
  const { maxOccurrences, paidPeriodsCount } = props.subscription;
  if (maxOccurrences == null) return null;
  return { paid: paidPeriodsCount, total: maxOccurrences };
});

// Null when there is no due date or it cannot be parsed — the chip is then omitted
// rather than rendered with a meaningless day count.
const due = computed<{ label: string; chipClass: string } | null>(() => {
  const { nextDueDate } = props.subscription;
  if (!nextDueDate) return null;

  const days = daysUntilDue({ dueDate: nextDueDate, now: props.now });
  if (days === null) return null;

  const isOverdue = isSubscriptionOverdue({ subscription: props.subscription, now: props.now });
  return {
    label: isOverdue
      ? t('planned.subscriptions.periods.overdueBadge')
      : t('planned.subscriptions.periods.inDays', { count: days }),
    chipClass: isOverdue ? 'bg-destructive/10 text-destructive-text' : 'bg-success-text/10 text-success-text',
  };
});
</script>

<template>
  <div
    :class="
      cn(
        'hover:bg-accent/50 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors',
        '@[700px]:grid-cols-[minmax(0,1fr)_7rem_6.5rem_auto_2rem_auto] @[700px]:gap-x-4 @[700px]:gap-y-0',
        !subscription.isActive && 'opacity-60',
      )
    "
    @click="emit('select', subscription)"
  >
    <!-- Identity: logo + name/badges, subtitle underneath -->
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
      <BrandLogo v-bind="toEntityLogoDisplayProps(subscription)" :name="subscription.name" class="size-8 shrink-0" />
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="min-w-0 truncate font-medium">{{ subscription.name }}</h3>
          <SubscriptionTypeBadge :type="subscription.type" class="shrink-0" />
          <span
            v-if="isCompleted"
            class="bg-success-text/10 text-success-text inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          >
            <CheckIcon class="size-3" />
            {{ $t('planned.subscriptions.completed') }}
          </span>
          <span
            v-else-if="!subscription.isActive"
            class="bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          >
            <CirclePauseIcon class="size-3" />
            {{ $t('planned.subscriptions.paused') }}
          </span>
        </div>
        <p class="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
          <template v-if="subscription.category">
            <span
              class="inline-block size-2 shrink-0 rounded-full"
              :style="{ backgroundColor: subscription.category.color }"
            />
            <span class="truncate">{{ subscription.category.name }}</span>
            <span aria-hidden="true">&middot;</span>
          </template>
          <span class="whitespace-nowrap">{{ formatFrequency({ frequency: subscription.frequency, t }) }}</span>
          <template v-if="installmentProgress">
            <span aria-hidden="true">&middot;</span>
            <span class="whitespace-nowrap">
              {{ $t('planned.subscriptions.progress.paidOfTotal', installmentProgress!) }}
            </span>
          </template>
        </p>
      </div>
    </div>

    <!-- Amount -->
    <span
      v-if="formattedAmount"
      :class="
        cn(
          'col-start-1 row-start-2 text-sm font-medium tabular-nums',
          '@[700px]:col-start-2 @[700px]:row-start-1 @[700px]:justify-self-end @[700px]:text-right',
          getTransactionTypeStyles(subscription.transactionType),
        )
      "
    >
      {{ getTransactionTypePrefix(subscription.transactionType) }}{{ formattedAmount }}
    </span>

    <!-- Due status: renders for every item with a usable next due date -->
    <span
      v-if="due"
      :class="
        cn(
          'col-start-2 row-start-2 inline-flex items-center gap-1 justify-self-end rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          '@[700px]:col-start-3 @[700px]:row-start-1 @[700px]:justify-self-start',
          due.chipClass,
        )
      "
    >
      {{ due.label }}
    </span>

    <!-- Linked txs + actions: one cluster on narrow, own grid columns on wide -->
    <div
      class="col-start-2 row-start-1 flex items-center justify-end gap-1 justify-self-end @[700px]:contents @sm:gap-2"
      @click.stop
    >
      <div class="@[700px]:col-start-4 @[700px]:row-start-1" @click="emit('select-linked', subscription)">
        <LinkedTransactionsBadge :count="subscription.linkedTransactionsCount" />
      </div>

      <div class="@[700px]:col-start-5 @[700px]:row-start-1">
        <DesktopOnlyTooltip
          v-if="subscription.currentPeriod"
          :content="$t('planned.subscriptions.periods.tooltips.markAsPaid')"
        >
          <Button variant="soft-success" size="icon-sm" :disabled="isMarkingPaid" @click="emit('pay', subscription)">
            <CheckIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>

      <div class="@[700px]:col-start-6 @[700px]:row-start-1">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="$t('planned.subscriptions.actions.more')">
              <MoreHorizontalIcon class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem v-if="!isCompleted" @select="emit('toggle-active', subscription)">
              <CirclePauseIcon v-if="subscription.isActive" class="size-4" />
              <RepeatIcon v-else class="size-4" />
              {{
                subscription.isActive
                  ? $t('planned.subscriptions.pauseSubscription')
                  : $t('planned.subscriptions.resumeSubscription')
              }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="!isCompleted" />
            <DropdownMenuItem
              class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
              @select="emit('delete', subscription)"
            >
              <Trash2Icon class="size-4" />
              {{ $t('planned.subscriptions.deleteSubscription') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </div>
</template>
