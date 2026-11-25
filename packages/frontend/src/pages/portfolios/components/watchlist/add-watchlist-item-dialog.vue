<script setup lang="ts">
import { createWatchlistItem } from '@/api/watchlist';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { type RecordId, WATCHLIST_LIMITS, type WatchlistSectionModel } from '@bt/shared/types';
import type { SecuritySearchResultFormatted } from '@bt/shared/types/investments';
import { PlusIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { useWatchlistMutation } from './use-watchlist';
import { isPriceInputInvalid, priceInputToDecimal } from './watchlist-helpers';
import WatchlistSectionDialog from './watchlist-section-dialog.vue';
import WatchlistSecurityPicker from './watchlist-security-picker.vue';

const props = defineProps<{ portfolioId: string; sections: Pick<WatchlistSectionModel, 'id' | 'name'>[] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const selected = ref<SecuritySearchResultFormatted | null>(null);
const sectionOption = ref<{ value: RecordId; label: string } | null>(null);
const note = ref<string | number>('');
const targetPrice = ref<string | number | null>(null);

const isSectionDialogOpen = ref(false);

const sectionOptions = computed(() => props.sections.map((section) => ({ value: section.id, label: section.name })));

watch(isOpen, (open) => {
  if (!open) return;
  selected.value = null;
  sectionOption.value = null;
  note.value = '';
  targetPrice.value = null;
});

const { isPending, mutate } = useWatchlistMutation({
  mutationFn: (payload: {
    searchResult: SecuritySearchResultFormatted;
    sectionId: RecordId | null;
    note: string | null;
    targetPrice: string | null;
  }) => createWatchlistItem({ portfolioId: props.portfolioId, ...payload }),
  successKey: 'portfolioDetail.watchlist.items.added',
  errorKey: 'portfolioDetail.watchlist.items.addError',
  onSuccess: () => {
    isOpen.value = false;
  },
});

const isTargetInvalid = computed(() => isPriceInputInvalid({ value: targetPrice.value }));

const submit = () => {
  if (!selected.value || isPending.value || isTargetInvalid.value) return;
  mutate({
    searchResult: selected.value,
    sectionId: sectionOption.value?.value ?? null,
    note: String(note.value).trim() || null,
    targetPrice: priceInputToDecimal({ value: targetPrice.value }),
  });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-lg">
    <template #title>{{ $t('portfolioDetail.watchlist.add.title') }}</template>
    <template #description>{{ $t('portfolioDetail.watchlist.add.description') }}</template>

    <form id="watchlist-add-form" class="grid gap-4" @submit.prevent="submit">
      <WatchlistSecurityPicker v-model="selected" :portfolio-id="portfolioId" />

      <SelectField
        v-model="sectionOption"
        :values="sectionOptions"
        clearable
        :label="$t('portfolioDetail.watchlist.add.sectionLabel')"
        :placeholder="$t('portfolioDetail.watchlist.notInSection')"
      >
        <template #select-bottom-content>
          <Button
            type="button"
            class="w-full justify-start"
            variant="ghost"
            size="sm"
            @click="isSectionDialogOpen = true"
          >
            <PlusIcon class="size-4" />
            {{ $t('portfolioDetail.watchlist.sections.new') }}
          </Button>
        </template>
      </SelectField>
      <InputField
        v-model="targetPrice"
        type="number"
        step="any"
        only-positive
        :label="
          selected
            ? $t('portfolioDetail.watchlist.add.targetLabelOptional', { currency: selected.currencyCode.toUpperCase() })
            : $t('portfolioDetail.watchlist.add.targetLabelOptionalNoCurrency')
        "
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
        <Button variant="outline" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
        <Button type="submit" form="watchlist-add-form" :disabled="!selected || isPending || isTargetInvalid">
          {{ $t('portfolioDetail.watchlist.add.submit') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>

  <WatchlistSectionDialog
    v-model:open="isSectionDialogOpen"
    :portfolio-id="portfolioId"
    :section="null"
    @created="(section) => (sectionOption = { value: section.id, label: section.name })"
  />
</template>
