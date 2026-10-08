<script setup lang="ts">
import { AccountGroups } from '@/common/types/models';
import { type LogoSelection, logoSelectionKey, toLogoSelection } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useUpdateAccountGroup } from '@/composable/data-queries/account-groups';
import { FolderIcon, SaveIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { resolveGroupUpdate } from './resolve-group-update';
import { resolveRename } from './resolve-rename';

const props = defineProps<{ group: AccountGroups }>();

const { t } = useI18n();

const name = ref(props.group.name);

// Renaming elsewhere (or collapsing and reopening the row) should not leave a stale
// draft in the field.
watch(
  () => props.group.name,
  (value) => {
    name.value = value;
  },
);

const storedLogo = computed(() =>
  toLogoSelection({
    logoDomain: props.group.logoDomain,
    logoInitials: props.group.logoInitials,
    logoColor: props.group.logoColor,
  }),
);

const logo = ref<LogoSelection | null>(storedLogo.value);
// Keyed on structure, not object identity: every refetch rebuilds the group object,
// and an identity-based watch would wipe an unsaved pick with an unchanged stored logo.
watch(
  () => logoSelectionKey({ selection: storedLogo.value }),
  () => {
    logo.value = storedLogo.value;
  },
);

const plan = computed(() =>
  resolveGroupUpdate({
    rename: resolveRename({ draftName: name.value, currentName: props.group.name }),
    logo: logo.value,
    storedLogo: storedLogo.value,
  }),
);
const canSubmit = computed(() => plan.value.updates !== null);
const nameError = computed(() =>
  plan.value.blockedBy === 'empty-name' ? t('settings.accountGroups.update.emptyNameError') : undefined,
);

const { mutate, isPending } = useUpdateAccountGroup({ groupId: () => props.group.id });

const submit = () => {
  const { updates } = plan.value;
  if (!updates || isPending.value) return;

  mutate(updates);
};
</script>

<template>
  <form
    class="flex flex-col gap-2 @[30rem]/account-groups:flex-row @[30rem]/account-groups:items-end"
    @submit.prevent="submit"
  >
    <div class="flex flex-1 items-end gap-2">
      <LogoSquareField
        v-model="logo"
        :name-for-search="name"
        :reset-label="$t('common.logo.remove')"
        size-class="size-10 rounded-lg"
      >
        <template #placeholder>
          <div class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FolderIcon class="text-muted-foreground size-5" aria-hidden="true" />
          </div>
        </template>
      </LogoSquareField>
      <InputField
        v-model="name"
        class="flex-1"
        :label="$t('settings.accountGroups.update.label')"
        :placeholder="$t('settings.accountGroups.update.placeholder')"
        :error-message="nameError"
      />
    </div>

    <Button type="submit" size="sm" :disabled="!canSubmit || isPending">
      <SaveIcon class="size-4" />
      {{ $t('settings.accountGroups.update.saveButton') }}
    </Button>
  </form>
</template>
