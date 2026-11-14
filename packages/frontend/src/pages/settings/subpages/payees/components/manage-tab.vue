<template>
  <div class="@container/payees-page">
    <div class="mb-4 flex items-center gap-2">
      <InputField
        v-model="searchQuery"
        :placeholder="$t('payees.searchPlaceholder')"
        class="flex-1"
        trailing-icon-css-class="px-2"
      >
        <template #iconLeading>
          <SearchIcon class="text-muted-foreground size-4" />
        </template>
        <template v-if="searchQuery" #iconTrailing>
          <DesktopOnlyTooltip :content="$t('common.actions.clear')">
            <UiButton
              type="button"
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground hover:text-foreground"
              :aria-label="$t('common.actions.clear')"
              @click="searchQuery = ''"
            >
              <XIcon class="size-4" />
            </UiButton>
          </DesktopOnlyTooltip>
        </template>
      </InputField>
      <DesktopOnlyTooltip :content="$t('payees.newPayeeButton')">
        <UiButton
          variant="outline"
          size="sm"
          class="shrink-0"
          :aria-label="$t('payees.newPayeeButton')"
          @click="openCreateDialog"
        >
          <PlusIcon class="size-4" />
          <span class="hidden @3xl/payees-page:inline">{{ $t('payees.newPayeeButton') }}</span>
        </UiButton>
      </DesktopOnlyTooltip>
    </div>

    <PayeesTable :search-query="debouncedQuery" />

    <PayeeFormDialog v-model:open="dialogState.isOpen" :payee="dialogState.payee" />
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import InputField from '@/components/fields/input-field.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { PlusIcon, SearchIcon, XIcon } from '@lucide/vue';
import { refDebounced, useSessionStorage } from '@vueuse/core';
import { computed, reactive } from 'vue';

import PayeeFormDialog from './payee-form-dialog.vue';
import PayeesTable from './payees-table.vue';

const DEBOUNCE_MS = 200;

const searchQuery = useSessionStorage('payees-search-query', '');
const searchQueryDebounced = refDebounced(searchQuery, DEBOUNCE_MS);
const debouncedQuery = computed(() => (searchQueryDebounced.value ?? '').trim());

const dialogState = reactive<{ isOpen: boolean; payee: null }>({ isOpen: false, payee: null });
const openCreateDialog = () => {
  dialogState.payee = null;
  dialogState.isOpen = true;
};
</script>
