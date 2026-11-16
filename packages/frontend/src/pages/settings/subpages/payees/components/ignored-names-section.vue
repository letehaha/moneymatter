<template>
  <div class="flex flex-col gap-4">
    <div>
      <h3 class="text-lg font-semibold">{{ $t('payees.ignoredNames.title') }}</h3>
      <p class="text-muted-foreground mt-1 text-sm">{{ $t('payees.ignoredNames.description') }}</p>
    </div>

    <div class="flex flex-col gap-2 @sm:flex-row">
      <InputField
        v-model="newRawName"
        :placeholder="$t('payees.ignoredNames.addPlaceholder')"
        class="flex-1"
        @keydown.enter="handleAdd"
      />
      <UiButton
        variant="outline"
        class="px-3"
        :disabled="!newRawName.trim() || addMut.isPending.value"
        @click="handleAdd"
      >
        <PlusIcon class="size-4" />
        {{ $t('payees.ignoredNames.addButton') }}
      </UiButton>
    </div>

    <div v-if="isLoading" class="text-muted-foreground py-4 text-center text-sm">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="list.length === 0" class="text-muted-foreground py-4 text-center text-sm">
      {{ $t('payees.ignoredNames.empty') }}
    </div>

    <ul v-else class="grid gap-1">
      <li
        v-for="row in list"
        :key="row.id"
        class="bg-muted/40 flex items-center justify-between gap-3 rounded px-3 py-2 text-sm"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ row.rawSample ?? row.normalizedName }}</p>
          <p
            v-if="row.rawSample && row.rawSample !== row.normalizedName"
            class="text-muted-foreground truncate text-xs"
          >
            {{ $t('payees.ignoredNames.normalizedLabel') }}: {{ row.normalizedName }}
          </p>
        </div>
        <DesktopOnlyTooltip :content="$t('payees.ignoredNames.removeTooltip')">
          <UiButton
            variant="ghost-destructive"
            size="icon-sm"
            :aria-label="$t('payees.ignoredNames.removeTooltip')"
            @click="confirmRemove(row)"
          >
            <Trash2Icon class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>
      </li>
    </ul>

    <ResponsiveAlertDialog
      v-model:open="forceConflictOpen"
      :confirm-label="$t('payees.ignoredNames.forceConfirm')"
      confirm-variant="destructive"
      @confirm="handleForce"
    >
      <template #title>{{ $t('payees.ignoredNames.conflictTitle') }}</template>
      <template #description>{{ $t('payees.ignoredNames.conflictDescription', { name: pendingRawName }) }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>

<script setup lang="ts">
import { useAddIgnoredName, useIgnoredNames, useRemoveIgnoredName } from '@/composable/data-queries/payees';
import type { IgnoredName } from '@/api/payees';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button as UiButton } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const { list, isLoading } = useIgnoredNames();
const addMut = useAddIgnoredName();
const removeMut = useRemoveIgnoredName();

const newRawName = ref('');
const pendingRawName = ref('');
const forceConflictOpen = ref(false);

async function handleAdd() {
  const raw = newRawName.value.trim();
  if (!raw) return;
  try {
    await addMut.mutateAsync({ rawName: raw });
    newRawName.value = '';
    addSuccessNotification(t('payees.ignoredNames.addedToast'));
  } catch (error) {
    // Backend returns 409 when an existing Payee matches the normalized form
    // — surface the conflict in a dialog so the user can choose to delete it.
    const isConflict = (error as { response?: { status?: number } })?.response?.status === 409;
    if (isConflict) {
      pendingRawName.value = raw;
      forceConflictOpen.value = true;
    } else {
      addErrorNotification(t('payees.ignoredNames.addError'));
    }
  }
}

async function handleForce() {
  if (!pendingRawName.value) return;
  try {
    await addMut.mutateAsync({ rawName: pendingRawName.value, force: true });
    newRawName.value = '';
    addSuccessNotification(t('payees.ignoredNames.addedToast'));
  } catch {
    addErrorNotification(t('payees.ignoredNames.addError'));
  } finally {
    pendingRawName.value = '';
  }
}

async function confirmRemove(row: IgnoredName) {
  try {
    await removeMut.mutateAsync({ id: row.id });
    addSuccessNotification(t('payees.ignoredNames.removedToast'));
  } catch {
    addErrorNotification(t('payees.ignoredNames.removeError'));
  }
}
</script>
