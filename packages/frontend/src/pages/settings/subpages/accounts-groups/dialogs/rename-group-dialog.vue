<script setup lang="ts">
import { AccountGroups } from '@/common/types/models';
import { type LogoSelection, toLogoSelection } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useUpdateAccountGroup } from '@/composable/data-queries/account-groups';
import { FolderIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { resolveGroupUpdate } from './resolve-group-update';
import { resolveRename } from './resolve-rename';

const props = defineProps<{ group: AccountGroups }>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const storedLogo = computed(() =>
  toLogoSelection({
    logoDomain: props.group.logoDomain,
    logoInitials: props.group.logoInitials,
    logoColor: props.group.logoColor,
  }),
);

const name = ref('');
const logo = ref<LogoSelection | null>(null);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.group.name;
    logo.value = storedLogo.value;
  },
  { immediate: true },
);

const plan = computed(() =>
  resolveGroupUpdate({
    rename: resolveRename({ draftName: name.value, currentName: props.group.name }),
    logo: logo.value,
    storedLogo: storedLogo.value,
  }),
);
const nameError = computed(() =>
  plan.value.blockedBy === 'empty-name' ? t('settings.accountGroups.update.emptyNameError') : undefined,
);

const { mutate, isPending } = useUpdateAccountGroup({
  groupId: () => props.group.id,
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = () => {
  const { updates } = plan.value;
  if (!updates || isPending.value) return;
  mutate(updates);
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('settings.accountGroups.dialogs.rename.title') }}</template>
    <template #description>{{ $t('settings.accountGroups.dialogs.rename.description') }}</template>

    <form class="flex items-start gap-3" @submit.prevent="submit">
      <LogoSquareField
        v-model="logo"
        :name-for-search="name"
        :reset-label="$t('common.logo.remove')"
        size-class="size-14 rounded-xl"
      >
        <template #placeholder>
          <div class="bg-muted flex size-14 shrink-0 items-center justify-center rounded-xl">
            <FolderIcon class="text-muted-foreground size-6" aria-hidden="true" />
          </div>
        </template>
      </LogoSquareField>

      <InputField
        v-model="name"
        class="min-w-0 flex-1"
        :label="$t('settings.accountGroups.update.label')"
        :placeholder="$t('settings.accountGroups.update.placeholder')"
        :error-message="nameError"
      />
    </form>

    <template #footer>
      <div class="grid w-full grid-cols-2 gap-2">
        <Button variant="outline" :disabled="isPending" @click="isOpen = false">
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button :disabled="!plan.updates || isPending" @click="submit">
          {{ $t('settings.accountGroups.dialogs.rename.submit') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
