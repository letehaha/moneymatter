<script setup lang="ts">
import { AccountGroups } from '@/common/types/models';
import GroupLogo from '@/components/common/group-logo.vue';
import { type LogoSelection, toOptionalLogoPayload } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { useAccountGroupPaths, useCreateAccountGroup } from '@/composable/data-queries/account-groups';
import { useOnboardingStore } from '@/stores/onboarding';
import { ChevronRightIcon, FolderIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ parentGroup?: AccountGroups }>();
const isOpen = defineModel<boolean>('open', { default: false });

const form = ref<{
  name: string;
  /** Manually chosen brand or monogram. null = no logo; the group renders a folder icon (groups have no auto-resolution). */
  logo: LogoSelection | null;
}>({
  name: '',
  logo: null,
});

watch(isOpen, (open) => {
  if (open) form.value = { name: '', logo: null };
});

const emit = defineEmits(['created']);

const { entries } = useAccountGroupPaths();

const parentChain = computed(() => {
  const groupById = new Map(entries.value.map(({ group }) => [group.id, group]));
  const chain: AccountGroups[] = [];
  const visitedIds = new Set<string>();
  let current = props.parentGroup;
  while (current && !visitedIds.has(current.id)) {
    visitedIds.add(current.id);
    chain.unshift(current);
    current = current.parentGroupId ? groupById.get(current.parentGroupId) : undefined;
  }
  return chain;
});

const { isPending: isMutating, mutate } = useCreateAccountGroup({
  onSuccess: () => {
    // Mark onboarding task as complete
    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('create-account-group');

    isOpen.value = false;
    emit('created');
  },
});
const isSubmitDisabled = computed(() => isMutating.value || !form.value.name);

const createGroup = () => {
  mutate({
    name: form.value.name,
    parentGroupId: props.parentGroup?.id,
    ...toOptionalLogoPayload({ selection: form.value.logo }),
  });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template v-if="$slots.default" #trigger>
      <slot />
    </template>

    <template #title>
      <span>
        {{
          parentGroup
            ? $t('dialogs.accountGroups.createDialog.subgroupTitle')
            : $t('dialogs.accountGroups.createDialog.title')
        }}
      </span>
    </template>

    <form class="mt-4" @submit.prevent="createGroup">
      <div v-if="parentGroup" class="mb-4 flex flex-col gap-1.5">
        <span class="text-sm font-medium">{{ $t('dialogs.accountGroups.createDialog.insideLabel') }}</span>
        <div class="bg-muted flex flex-wrap items-center gap-1.5 rounded-lg px-3 py-2 text-sm">
          <template v-for="(group, index) in parentChain" :key="group.id">
            <ChevronRightIcon v-if="index > 0" class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span class="flex min-w-0 items-center gap-1.5">
              <GroupLogo :group="group" size="size-5" variant="tile" />
              <span class="truncate font-medium">{{ group.name }}</span>
            </span>
          </template>
        </div>
      </div>

      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InputField
            v-model="form.name"
            :label="$t('dialogs.accountGroups.createDialog.nameLabel')"
            :placeholder="
              parentGroup
                ? $t('dialogs.accountGroups.createDialog.subgroupNamePlaceholder')
                : $t('dialogs.accountGroups.createDialog.namePlaceholder')
            "
          />
        </div>
        <LogoSquareField
          v-model="form.logo"
          :name-for-search="form.name"
          :reset-label="$t('common.logo.remove')"
          size-class="size-10 rounded-lg"
          align="with-labeled-field"
        >
          <template #placeholder>
            <div class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FolderIcon class="text-muted-foreground size-5" aria-hidden="true" />
            </div>
          </template>
        </LogoSquareField>
      </div>

      <div class="mt-4 flex">
        <UiButton class="mt-3 w-full" :disabled="isSubmitDisabled">
          {{
            parentGroup
              ? $t('dialogs.accountGroups.createDialog.createSubgroupButton')
              : $t('dialogs.accountGroups.createDialog.createButton')
          }}
        </UiButton>
      </div>
    </form>
  </ResponsiveDialog>
</template>
