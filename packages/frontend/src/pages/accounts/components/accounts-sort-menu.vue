<template>
  <Popover.Popover :open="isOpen" @update:open="isOpen = $event">
    <Popover.PopoverTrigger as-child>
      <UiButton v-if="triggerVariant === 'labeled'" variant="outline">
        <ArrowUpDownIcon class="size-4" />
        <span>{{ currentLabel }}</span>
        <ChevronDownIcon class="size-4 opacity-60" />
      </UiButton>
      <UiButton v-else variant="outline" size="icon" :aria-label="$t('accounts.sort.ariaLabel')">
        <ArrowUpDownIcon class="size-4" />
      </UiButton>
    </Popover.PopoverTrigger>

    <Popover.PopoverContent align="end" class="w-44 p-1">
      <UiButton
        v-for="opt in options"
        :key="opt.key"
        variant="ghost"
        size="sm"
        class="w-full justify-start gap-2"
        @click="selectSort(opt.key)"
      >
        <CheckIcon class="size-4" :class="opt.key === sortKey ? 'opacity-100' : 'opacity-0'" />
        {{ opt.label }}
      </UiButton>

      <Separator class="my-1" />

      <UiButton
        v-for="opt in directionOptions"
        :key="opt.direction"
        variant="ghost"
        size="sm"
        class="w-full justify-start gap-2"
        :aria-pressed="opt.direction === sortDirection"
        @click="selectDirection(opt.direction)"
      >
        <CheckIcon class="size-4" :class="opt.direction === sortDirection ? 'opacity-100' : 'opacity-0'" />
        {{ opt.label }}
      </UiButton>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>

<script setup lang="ts">
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import { Separator } from '@/components/lib/ui/separator';
import { ArrowUpDownIcon, CheckIcon, ChevronDownIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ACCOUNTS_SORT_KEYS, type AccountsSortDirection, type AccountsSortKey } from '../accounts-sort';
import { useAccountsSort } from '../use-accounts-sort';

defineProps<{ triggerVariant: 'labeled' | 'icon' }>();

const { t } = useI18n();
const { sortKey, setSortKey, sortDirection } = useAccountsSort();

const isOpen = ref(false);

const sortLabels = computed<Record<AccountsSortKey, string>>(() => ({
  auto: t('accounts.sort.auto'),
  name: t('accounts.sort.name'),
  balance: t('accounts.sort.balance'),
}));

const options = computed(() => ACCOUNTS_SORT_KEYS.map((key) => ({ key, label: sortLabels.value[key] })));

const currentLabel = computed(() => sortLabels.value[sortKey.value]);

const selectSort = (key: AccountsSortKey) => {
  setSortKey(key);
  isOpen.value = false;
};

// Balance reads as magnitude, names as alphabet; "ascending" alone is ambiguous for either.
const directionOptions = computed<{ direction: AccountsSortDirection; label: string }[]>(() =>
  sortKey.value === 'balance'
    ? [
        { direction: 'desc', label: t('accounts.sort.direction.highestFirst') },
        { direction: 'asc', label: t('accounts.sort.direction.lowestFirst') },
      ]
    : [
        { direction: 'asc', label: t('accounts.sort.direction.aToZ') },
        { direction: 'desc', label: t('accounts.sort.direction.zToA') },
      ],
);

const selectDirection = (direction: AccountsSortDirection) => {
  sortDirection.value = direction;
  isOpen.value = false;
};
</script>
