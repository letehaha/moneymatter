<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { UnlinkIcon, XIcon } from '@lucide/vue';

defineProps<{ count: number; isAllSelected: boolean; isUnlinking: boolean }>();

const emit = defineEmits<{
  toggleAll: [];
  unlink: [];
  cancel: [];
}>();
</script>

<template>
  <Checkbox
    :model-value="isAllSelected ? true : 'indeterminate'"
    :aria-label="$t('pages.budgets.transactionsList.selectAll')"
    @update:model-value="emit('toggleAll')"
  />
  <span class="text-sm font-medium tabular-nums">
    {{ $t('pages.budgets.transactionsList.selected', { count }) }}
  </span>
  <Button variant="soft-destructive" size="sm" class="ml-auto" :disabled="isUnlinking" @click="emit('unlink')">
    <UnlinkIcon class="size-4" />
    {{ $t('pages.budgets.transactionsList.unlink') }}
  </Button>
  <DesktopOnlyTooltip :content="$t('pages.budgets.transactionsList.cancel')">
    <Button
      variant="ghost"
      size="icon-sm"
      :disabled="isUnlinking"
      :aria-label="$t('pages.budgets.transactionsList.cancel')"
      @click="emit('cancel')"
    >
      <XIcon class="size-4" />
    </Button>
  </DesktopOnlyTooltip>
</template>
