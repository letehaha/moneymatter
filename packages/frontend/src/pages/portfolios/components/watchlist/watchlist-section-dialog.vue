<script setup lang="ts">
import { createWatchlistSection, updateWatchlistSection } from '@/api/watchlist';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { WATCHLIST_LIMITS, type WatchlistSectionModel } from '@bt/shared/types';
import { computed, ref, watch } from 'vue';

import { useWatchlistMutation } from './use-watchlist';

const props = defineProps<{
  portfolioId: string;
  /** Renames this section; without it the dialog creates one. */
  section: Pick<WatchlistSectionModel, 'id' | 'name'> | null;
}>();
const isOpen = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ created: [section: WatchlistSectionModel] }>();

const name = ref('');
watch(isOpen, (open) => {
  if (open) name.value = props.section?.name ?? '';
});

const trimmed = computed(() => name.value.trim());
const close = () => {
  isOpen.value = false;
};

const createMutation = useWatchlistMutation({
  mutationFn: createWatchlistSection,
  successKey: 'portfolioDetail.watchlist.sections.created',
  errorKey: 'portfolioDetail.watchlist.sections.saveError',
  onSuccess: (section) => {
    emit('created', section);
    close();
  },
});
const renameMutation = useWatchlistMutation({
  mutationFn: updateWatchlistSection,
  successKey: 'portfolioDetail.watchlist.sections.renamed',
  errorKey: 'portfolioDetail.watchlist.sections.saveError',
  onSuccess: close,
});

const isPending = computed(() => createMutation.isPending.value || renameMutation.isPending.value);

const submit = () => {
  if (!trimmed.value || isPending.value) return;
  if (props.section) {
    renameMutation.mutate({ portfolioId: props.portfolioId, sectionId: props.section.id, name: trimmed.value });
  } else {
    createMutation.mutate({ portfolioId: props.portfolioId, name: trimmed.value });
  }
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-md">
    <template #title>
      {{
        section
          ? $t('portfolioDetail.watchlist.sections.renameTitle')
          : $t('portfolioDetail.watchlist.sections.newTitle')
      }}
    </template>

    <form id="watchlist-section-form" @submit.prevent="submit">
      <InputField
        v-model="name"
        autofocus
        :label="$t('portfolioDetail.watchlist.sections.nameLabel')"
        :placeholder="$t('portfolioDetail.watchlist.sections.namePlaceholder')"
        :maxlength="WATCHLIST_LIMITS.sectionNameMaxLength"
      />
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button type="submit" form="watchlist-section-form" :disabled="!trimmed || isPending">
          {{ $t('common.actions.save') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
