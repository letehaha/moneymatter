<script setup lang="ts">
import InvestmentTransactionsList from '@/components/investments/investment-transactions-list.vue';
import { Button } from '@/components/lib/ui/button';
import { useGetHoldingTransactionsInfinite } from '@/composable/data-queries/investment-transactions';
import { PlusIcon, ReceiptIcon } from '@lucide/vue';
import { computed, toRef } from 'vue';

const props = defineProps<{
  portfolioId: string;
  securityId: string;
}>();

defineEmits<{ (e: 'add-transaction'): void }>();

const {
  data: transactionsPages,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isFetching: isLoading,
} = useGetHoldingTransactionsInfinite(
  toRef(() => props.portfolioId),
  toRef(() => props.securityId),
);

const transactions = computed(() => transactionsPages.value?.pages.flatMap((p) => p.transactions) ?? []);
const isEmpty = computed(() => !isLoading.value && transactions.value.length === 0);
</script>

<template>
  <!-- The parent full-width <td colspan> spans the holdings table's full scrolled
       width. 100cqw (visible width of the @container holdings scroll wrapper,
       minus the ml-4 indent) + sticky keep the section on screen so its own
       scrollbar handles all of its overflow. -->
  <div class="border-primary/20 sticky left-0 ml-4 border-l-2" style="width: calc(100cqw - 1rem)">
    <div v-if="isLoading && transactions.length === 0" class="p-6 text-center">
      <div class="border-primary/20 mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-t-transparent"></div>
      <p class="text-muted-foreground text-sm">
        {{ $t('portfolioDetail.holdingsTable.transactions.loading') }}
      </p>
    </div>
    <InvestmentTransactionsList
      v-else-if="transactions.length > 0"
      :transactions="transactions"
      :has-next-page="!!hasNextPage"
      :is-fetching-next-page="isFetchingNextPage"
      :fetch-next-page="fetchNextPage"
      @add-transaction="$emit('add-transaction')"
    />
    <div v-else-if="isEmpty" class="p-6 text-center">
      <div class="bg-muted mx-auto mb-3 flex size-10 items-center justify-center rounded-full">
        <ReceiptIcon class="text-muted-foreground size-5" />
      </div>
      <p class="text-muted-foreground mb-3 text-sm">
        {{ $t('portfolioDetail.holdingsTable.transactions.empty') }}
      </p>
      <Button variant="outline" size="sm" @click="$emit('add-transaction')">
        <PlusIcon class="size-4" />
        {{ $t('portfolioDetail.holdingsTable.transactions.addFirstButton') }}
      </Button>
    </div>
  </div>
</template>
