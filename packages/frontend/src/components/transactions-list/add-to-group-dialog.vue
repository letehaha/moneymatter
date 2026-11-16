<script setup lang="ts">
import * as transactionGroupsApi from '@/api/transaction-groups';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { invalidateTransactionGroupQueries } from '@/composable/data-queries/transaction-groups';
import { getApiErrorMessage } from '@/js/errors';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { CheckIcon, SearchIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  open?: boolean;
  transactionIds: string[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  added: [];
}>();

const queryClient = useQueryClient();

const { data: groups, isLoading } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.transactionGroupsList,
  queryFn: () => transactionGroupsApi.loadTransactionGroups(),
  initialData: [],
  enabled: computed(() => !!props.open),
});

const searchQuery = ref('');
const selectedGroupId = ref<string | null>(null);
const isSubmitting = ref(false);
const error = ref('');

watch(
  () => props.open,
  (val) => {
    if (val) {
      searchQuery.value = '';
      selectedGroupId.value = null;
      error.value = '';
    }
  },
);

const filteredGroups = computed(() => {
  if (!searchQuery.value) return groups.value;
  const q = searchQuery.value.toLowerCase();
  return groups.value.filter((g) => g.name.toLowerCase().includes(q));
});

const handleSubmit = async () => {
  if (!selectedGroupId.value || !props.transactionIds.length) return;

  isSubmitting.value = true;
  error.value = '';

  try {
    await transactionGroupsApi.addTransactionsToGroup({
      groupId: selectedGroupId.value,
      transactionIds: props.transactionIds,
    });

    invalidateTransactionGroupQueries({ queryClient });

    emit('update:open', false);
    emit('added');
  } catch (e) {
    error.value = getApiErrorMessage({
      e,
      t,
      conflictKey: 'transactions.transactionGroups.errors.alreadyInGroup',
      fallbackKey: 'transactions.transactionGroups.errors.addFailed',
    });
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <ResponsiveDialog :open="open" dialog-content-class="sm:max-w-md" @update:open="emit('update:open', $event)">
    <template #title>{{ t('transactions.transactionGroups.addToGroupDialog.title') }}</template>
    <template #description>
      Add {{ transactionIds.length }} selected transaction{{ transactionIds.length !== 1 ? 's' : '' }} to a group
    </template>

    <div class="space-y-3 py-2">
      <!-- Search -->
      <div class="relative">
        <SearchIcon class="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          v-model="searchQuery"
          class="border-input bg-input-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
          :placeholder="t('transactions.transactionGroups.addToGroupDialog.searchPlaceholder')"
        />
      </div>

      <!-- Group list -->
      <div v-if="isLoading" class="space-y-2">
        <div v-for="i in 3" :key="i" class="bg-muted h-10 animate-pulse rounded" />
      </div>

      <div v-else-if="filteredGroups.length === 0" class="text-muted-foreground py-6 text-center text-sm">
        {{
          searchQuery
            ? t('transactions.transactionGroups.addToGroupDialog.noSearchResultsMessage')
            : t('transactions.transactionGroups.addToGroupDialog.noGroupsMessage')
        }}
      </div>

      <div v-else class="max-h-60 space-y-1 overflow-y-auto">
        <button
          v-for="group in filteredGroups"
          :key="group.id"
          :class="[
            'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
            selectedGroupId === group.id ? 'bg-primary/10 text-primary-text' : 'hover:bg-hover',
          ]"
          @click="selectedGroupId = group.id"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ group.name }}</p>
            <p v-if="group.transactionCount !== undefined" class="text-muted-foreground text-xs">
              {{ group.transactionCount }}
              {{ t('transactions.transactionGroups.addToGroupDialog.transactionCountLabel') || 'transactions' }}
            </p>
          </div>
          <CheckIcon v-if="selectedGroupId === group.id" class="text-primary-text ml-2 size-4 shrink-0" />
        </button>
      </div>

      <p v-if="error" class="text-destructive-text text-sm">{{ error }}</p>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" @click="emit('update:open', false)">{{
          t('transactions.transactionGroups.addToGroupDialog.cancelButton')
        }}</Button>
        <Button :disabled="!selectedGroupId || isSubmitting" @click="handleSubmit">
          {{
            isSubmitting
              ? t('transactions.transactionGroups.addToGroupDialog.addingText')
              : t('transactions.transactionGroups.addToGroupDialog.buttonLabel')
          }}
        </Button>
      </div>
    </div>
  </ResponsiveDialog>
</template>
