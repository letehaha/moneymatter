<script setup lang="ts">
import { AccountGroups } from '@/common/types/models';
import GroupLogo from '@/components/common/group-logo.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useAccountGroupPaths, useUpdateAccountGroup } from '@/composable/data-queries/account-groups';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { listMoveTargets } from './move-target-options';

interface ParentOption {
  id: string | null;
  label: string;
  group: AccountGroups | null;
}

const props = defineProps<{ group: AccountGroups }>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { entries } = useAccountGroupPaths();

const options = computed<ParentOption[]>(() => [
  { id: null, label: t('settings.accountGroups.dialogs.move.noParent'), group: null },
  ...listMoveTargets({ group: props.group, entries: entries.value }).map(({ group, path }) => ({
    id: group.id,
    label: path,
    group,
  })),
]);

const parentGroupId = ref<string | null>(null);

watch(
  isOpen,
  (open) => {
    if (open) parentGroupId.value = props.group.parentGroupId;
  },
  { immediate: true },
);

const selectedOption = computed(() => options.value.find((option) => option.id === parentGroupId.value) ?? null);
const hasChanged = computed(() => parentGroupId.value !== props.group.parentGroupId);

const { mutate, isPending } = useUpdateAccountGroup({
  groupId: () => props.group.id,
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = () => {
  if (!hasChanged.value || isPending.value) return;
  mutate({ parentGroupId: parentGroupId.value });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('settings.accountGroups.dialogs.move.title', { name: group.name }) }}</template>
    <template #description>{{ $t('settings.accountGroups.dialogs.move.description') }}</template>

    <form class="grid gap-1.5" @submit.prevent="submit">
      <SelectField
        :model-value="selectedOption"
        :values="options"
        label-key="label"
        :value-key="(option) => option.id ?? ''"
        :label="$t('settings.accountGroups.dialogs.move.parentLabel')"
        :placeholder="$t('settings.accountGroups.dialogs.move.parentPlaceholder')"
        with-search
        @update:model-value="(option) => (parentGroupId = option?.id ?? null)"
      >
        <template #item="{ item, label }">
          <span class="flex min-w-0 items-center gap-2">
            <GroupLogo v-if="item.group" :group="item.group" size="size-5" variant="tile" />
            <span class="truncate">{{ label }}</span>
          </span>
        </template>
      </SelectField>

      <p class="text-muted-foreground text-xs">{{ $t('settings.accountGroups.dialogs.move.hint') }}</p>
    </form>

    <template #footer>
      <div class="grid w-full grid-cols-2 gap-2">
        <Button variant="outline" :disabled="isPending" @click="isOpen = false">
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button :disabled="!hasChanged || isPending" @click="submit">
          {{ $t('settings.accountGroups.dialogs.move.submit') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
