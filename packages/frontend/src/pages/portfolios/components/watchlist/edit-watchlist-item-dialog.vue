<script setup lang="ts">
import { updateWatchlistItem } from '@/api/watchlist';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { WATCHLIST_LIMITS, type WatchlistItemModel } from '@bt/shared/types';
import { computed, ref, watch } from 'vue';

import { useWatchlistMutation } from './use-watchlist';
import { isPriceInputInvalid, priceInputToDecimal } from './watchlist-helpers';

const props = defineProps<{ portfolioId: string; item: WatchlistItemModel | null }>();
const isOpen = defineModel<boolean>('open', { required: true });

const note = ref<string | number>('');
const targetPrice = ref<string | number | null>(null);
const initialTargetPrice = ref<string | number | null>(null);

watch(isOpen, (open) => {
  if (!open || !props.item) return;
  note.value = props.item.note ?? '';
  targetPrice.value = props.item.targetPrice === null ? null : Number(props.item.targetPrice);
  initialTargetPrice.value = targetPrice.value;
});

const close = () => {
  isOpen.value = false;
};

const { isPending, mutate } = useWatchlistMutation({
  mutationFn: updateWatchlistItem,
  successKey: 'portfolioDetail.watchlist.items.updated',
  errorKey: 'portfolioDetail.watchlist.items.saveError',
  onSuccess: close,
});

const isTargetInvalid = computed(() => isPriceInputInvalid({ value: targetPrice.value }));

const submit = () => {
  if (!props.item || isPending.value || isTargetInvalid.value) return;
  const nextTargetPrice = priceInputToDecimal({ value: targetPrice.value });
  mutate({
    portfolioId: props.portfolioId,
    itemId: props.item.id,
    note: String(note.value).trim() || null,
    ...(nextTargetPrice !== priceInputToDecimal({ value: initialTargetPrice.value }) && {
      targetPrice: nextTargetPrice,
    }),
  });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-md">
    <template #title>{{ $t('portfolioDetail.watchlist.items.editTitle') }}</template>
    <template v-if="item" #description>{{
      [item.security.symbol, item.security.name].filter(Boolean).join(' · ')
    }}</template>

    <form v-if="item" id="watchlist-item-form" class="grid gap-4" @submit.prevent="submit">
      <InputField
        v-model="targetPrice"
        type="number"
        step="any"
        only-positive
        :label="$t('portfolioDetail.watchlist.items.targetLabel', { currency: item.security.currencyCode })"
        :placeholder="$t('portfolioDetail.watchlist.items.targetPlaceholder')"
        :error-message="isTargetInvalid ? $t('forms.validators.mustBePositive') : undefined"
      />
      <TextareaField
        v-model="note"
        :label="$t('portfolioDetail.watchlist.items.noteLabel')"
        :placeholder="$t('portfolioDetail.watchlist.items.notePlaceholder')"
        :maxlength="WATCHLIST_LIMITS.noteMaxLength"
      />
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button type="submit" form="watchlist-item-form" :disabled="isPending || isTargetInvalid">
          {{ $t('common.actions.save') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
