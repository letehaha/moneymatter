<script lang="ts" setup>
import CategoryCircle from '@/components/common/category-circle.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { formatUIAmount } from '@/js/helpers';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { XIcon } from '@lucide/vue';
import { format } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  transaction: TransactionModel;
  removeLabel: string;
  disabled?: boolean;
  selectable?: boolean;
}>();

const emit = defineEmits<{ select: []; remove: [] }>();

const { t } = useI18n();
const { categoriesMap } = storeToRefs(useCategoriesStore());

// The category is carried by the icon, so the text slot goes to the note.
const label = computed(() => {
  if (props.transaction.note) return props.transaction.note;
  return categoriesMap.value[props.transaction.categoryId]?.name ?? t('common.labels.unknown');
});
</script>

<template>
  <div
    class="border-input bg-input-background flex w-full min-w-0 items-stretch justify-between gap-2 rounded-md border py-1.5 pr-3 pl-2 text-sm"
  >
    <Button
      v-if="selectable"
      type="button"
      variant="ghost"
      class="h-auto min-w-0 flex-1 justify-start gap-2 p-0 text-left font-normal hover:bg-transparent"
      :disabled="disabled"
      @click="emit('select')"
    >
      <CategoryCircle :category-id="transaction.categoryId" />
      <span class="truncate">{{ label }}</span>
    </Button>

    <div v-else class="flex min-w-0 flex-1 items-center gap-2">
      <CategoryCircle :category-id="transaction.categoryId" />
      <span class="truncate">{{ label }}</span>
    </div>

    <span class="flex shrink-0 items-center gap-2">
      <span
        :class="
          transaction.transactionType === TRANSACTION_TYPES.income ? 'text-app-income-color' : 'text-app-expense-color'
        "
        class="text-amount"
      >
        {{ formatUIAmount(transaction.amount, { currency: transaction.currencyCode, meta: transaction.currencyMeta }) }}
      </span>
      <span class="text-muted-foreground text-xs">{{ format(new Date(transaction.time), 'd MMM') }}</span>
      <DesktopOnlyTooltip :content="removeLabel">
        <!-- Negative margins cancel the row's padding so the hit area reaches the border on three sides. -->
        <Button
          type="button"
          variant="ghost"
          class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text -my-1.5 -mr-3 h-auto self-stretch rounded-none rounded-r-md px-2.5 py-0"
          :disabled="disabled"
          :aria-label="removeLabel"
          @click.stop="emit('remove')"
        >
          <XIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </span>
  </div>
</template>
