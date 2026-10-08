<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useShareInvitationDialog } from '@/composable/use-share-invitation-dialog';
import { useUserStore } from '@/stores';
import { type BudgetModel, RESOURCE_TYPES } from '@bt/shared/types';
import { useVModel } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

/**
 * Per-budget share invitation dialog. Mirrors `share-account-dialog.vue` but drops:
 *  - The transactions-write-scope select — budgets have no per-tx policy in MVP. A
 *    recipient with `write` can attach only their own transactions; `manage` covers
 *    everything else. There is nothing for a scope toggle to mean.
 *  - The household-override hint — budgets are explicit-share only (no household
 *    auto-grant), so a per-resource share never "overrides" a household grant.
 */

const props = defineProps<{
  budget: BudgetModel;
  open?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { isDemo } = storeToRefs(useUserStore());

const isOpen = useVModel(props, 'open', emit, { passive: true });

const { email, permission, permissionOptions, canSubmit, mutation, submit } = useShareInvitationDialog({
  resourceType: RESOURCE_TYPES.budget,
  resourceId: computed(() => props.budget.id),
  isOpen,
  i18nNamespace: 'dialogs.shareBudgetDialog',
});
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('dialogs.shareBudgetDialog.title') }}</template>
    <template #description>
      {{ $t('dialogs.shareBudgetDialog.description', { name: budget.name }) }}
    </template>

    <form class="grid gap-4" @submit.prevent="submit">
      <InputField
        v-model="email"
        :label="$t('dialogs.shareBudgetDialog.emailLabel')"
        :placeholder="$t('dialogs.shareBudgetDialog.emailPlaceholder')"
        type="email"
        autocomplete="email"
      />

      <SelectField
        v-model="permission"
        :label="$t('dialogs.shareBudgetDialog.permissionLabel')"
        :values="permissionOptions"
        label-key="label"
        value-key="value"
      />

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="isOpen = false">
          {{ $t('dialogs.shareBudgetDialog.cancel') }}
        </Button>
        <DemoRestricted feature="share_budget_dialog_submit">
          <Button type="submit" :disabled="!canSubmit || isDemo" :loading="mutation.isPending.value">
            {{ $t('dialogs.shareBudgetDialog.send') }}
          </Button>
        </DemoRestricted>
      </div>
    </form>
  </ResponsiveDialog>
</template>
