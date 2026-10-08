<script setup lang="ts">
import { listSentShareInvitations } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useShareInvitationDialog } from '@/composable/use-share-invitation-dialog';
import { useUserStore } from '@/stores';
import { useOnboardingStore } from '@/stores/onboarding';
import { type AccountModel, RESOURCE_TYPES, SHARE_INVITATION_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { useVModel } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
  open?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const { isDemo } = storeToRefs(useUserStore());
const onboardingStore = useOnboardingStore();

const isOpen = useVModel(props, 'open', emit, { passive: true });

const {
  email,
  permission,
  permissionOptions,
  writeScope,
  writeScopeOptions,
  showsWriteScope,
  isEmailValid,
  canSubmit,
  mutation,
  submit,
} = useShareInvitationDialog({
  resourceType: RESOURCE_TYPES.account,
  resourceId: computed(() => props.account.id),
  isOpen,
  i18nNamespace: 'dialogs.shareAccountDialog',
  withWriteScope: true,
  onSuccess: () => onboardingStore.completeTask('share-account'),
});

// Inverse-invite hint: surface a non-blocking note when the typed email belongs to a
// user already in the owner's household. The per-resource share simply overrides the
// household grant on this account (per-resource access wins over household-level), so
// we inform rather than block. Hooks the sent-invitations cache the owner already
// loads in Settings → Household so it's usually warm by the time this dialog opens.
//
// `isError` matters: when the lookup fails we can't tell whether the typed email
// belongs to a household member or not. The hint is non-blocking, so silently hiding
// it would be a regression — `sentInvitationsLookupFailed` lets the template render an
// inline "couldn't check household membership" line so the owner isn't caught by
// surprise once the per-resource share takes effect.
const { data: sentInvitations, isError: isSentInvitationsError } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent,
  queryFn: listSentShareInvitations,
  enabled: computed(() => isOpen.value),
});

const sentInvitationsLookupFailed = computed(() => isSentInvitationsError.value);

const householdMembers = computed(() =>
  (sentInvitations.value ?? []).filter(
    (invitation) =>
      invitation.resourceType === RESOURCE_TYPES.household && invitation.status === SHARE_INVITATION_STATUSES.accepted,
  ),
);

const matchingHouseholdMember = computed(() => {
  const typed = email.value.trim().toLowerCase();
  if (!typed) return null;
  return householdMembers.value.find((m) => m.inviteeEmail.toLowerCase() === typed) ?? null;
});

const matchingMemberLabel = computed(() => {
  const member = matchingHouseholdMember.value;
  if (!member) return '';
  return member.invitee?.username || member.inviteeEmail.split('@')[0] || '';
});

const matchingMemberPermissionLabel = computed(() => {
  const member = matchingHouseholdMember.value;
  if (!member) return '';
  if (member.permission === SHARE_PERMISSIONS.read) return t('dialogs.shareAccountDialog.permissions.read');
  if (member.permission === SHARE_PERMISSIONS.write) return t('dialogs.shareAccountDialog.permissions.write');
  return t('dialogs.shareAccountDialog.permissions.manage');
});
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('dialogs.shareAccountDialog.title') }}</template>
    <template #description>
      {{ $t('dialogs.shareAccountDialog.description', { name: account.name }) }}
    </template>

    <form class="grid gap-4" @submit.prevent="submit">
      <InputField
        v-model="email"
        :label="$t('dialogs.shareAccountDialog.emailLabel')"
        :placeholder="$t('dialogs.shareAccountDialog.emailPlaceholder')"
        type="email"
        autocomplete="email"
      />

      <p v-if="matchingHouseholdMember" class="text-muted-foreground -mt-2 text-xs" data-testid="inverse-invite-hint">
        <i18n-t keypath="dialogs.shareAccountDialog.householdOverrideHint" tag="span">
          <template #invitee>
            <strong class="text-foreground">@{{ matchingMemberLabel }}</strong>
          </template>
          <template #permission>
            <strong class="text-foreground">{{ matchingMemberPermissionLabel }}</strong>
          </template>
        </i18n-t>
      </p>

      <p
        v-else-if="sentInvitationsLookupFailed && isEmailValid"
        class="text-muted-foreground -mt-2 text-xs"
        data-testid="inverse-invite-lookup-failed"
      >
        {{ $t('dialogs.shareAccountDialog.householdLookupFailed') }}
      </p>

      <SelectField
        v-model="permission"
        :label="$t('dialogs.shareAccountDialog.permissionLabel')"
        :values="permissionOptions"
        label-key="label"
        value-key="value"
      />

      <template v-if="showsWriteScope">
        <SelectField
          v-model="writeScope"
          :label="$t('dialogs.shareAccountDialog.writeScopeLabel')"
          :values="writeScopeOptions"
          label-key="label"
          value-key="value"
        />
      </template>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="isOpen = false">
          {{ $t('dialogs.shareAccountDialog.cancel') }}
        </Button>
        <DemoRestricted feature="share_account_dialog_submit">
          <Button type="submit" :disabled="!canSubmit || isDemo" :loading="mutation.isPending.value">
            {{ $t('dialogs.shareAccountDialog.send') }}
          </Button>
        </DemoRestricted>
      </div>
    </form>
  </ResponsiveDialog>
</template>
