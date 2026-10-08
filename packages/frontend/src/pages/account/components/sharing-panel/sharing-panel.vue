<script setup lang="ts">
import {
  type ShareMemberRow,
  cancelShareInvitation,
  listShareMembers,
  listSentShareInvitations,
  resendShareInvitation,
  revokeShareMember,
  updateShareMember,
} from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import ShareAccountDialog from '@/components/dialogs/share-account-dialog.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useAccountAccess } from '@/composable/use-account-access';
import { useCopyInviteLink } from '@/composable/use-copy-invite-link';
import { ApiErrorResponseError } from '@/js/errors';
import { useUserStore } from '@/stores';
import {
  type AccountModel,
  RESOURCE_TYPES,
  SHARE_INVITATION_STATUSES,
  SHARE_PERMISSIONS,
  type ShareInvitationModel,
  type SharePermission,
  TRANSACTIONS_WRITE_SCOPES,
  type TransactionsWriteScope,
} from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CopyIcon, MailIcon, RotateCwIcon, Trash2Icon, UserIcon, UserPlusIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
}>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { copyInviteLink } = useCopyInviteLink();
const queryClient = useQueryClient();
const { user, isDemo } = storeToRefs(useUserStore());

const { isOwner, permission } = useAccountAccess(toRef(() => props.account));
const canManage = computed(() => isOwner.value || permission.value === SHARE_PERMISSIONS.manage);

const resourceArgs = computed(() => ({
  resourceType: RESOURCE_TYPES.account,
  resourceId: props.account.id,
}));

const membersQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.account, props.account.id]),
  queryFn: () => listShareMembers(resourceArgs.value),
  enabled: canManage,
});

const sentInvitationsQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent,
  queryFn: () => listSentShareInvitations(),
  enabled: isOwner,
});

const accountResourceId = computed(() => String(props.account.id));
const pendingInvitationsForAccount = computed(() => {
  if (!sentInvitationsQuery.data.value) return [];
  return sentInvitationsQuery.data.value.filter(
    (inv) =>
      inv.resourceType === RESOURCE_TYPES.account &&
      String(inv.resourceId) === accountResourceId.value &&
      inv.status === SHARE_INVITATION_STATUSES.pending,
  );
});

const invalidateMembers = () =>
  queryClient.invalidateQueries({
    queryKey: [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.account, props.account.id],
  });

const invalidateInvitations = () =>
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });

const apiErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof ApiErrorResponseError && err.data?.message) return err.data.message;
  return fallback;
};

interface PermissionOption {
  label: string;
  value: SharePermission;
}
const permissionOptions = computed<PermissionOption[]>(() => [
  { label: t('pages.account.sharing.permissions.read'), value: SHARE_PERMISSIONS.read },
  { label: t('pages.account.sharing.permissions.write'), value: SHARE_PERMISSIONS.write },
  { label: t('pages.account.sharing.permissions.manage'), value: SHARE_PERMISSIONS.manage },
]);

interface ScopeOption {
  label: string;
  value: TransactionsWriteScope;
}
const scopeOptions = computed<ScopeOption[]>(() => [
  { label: t('pages.account.sharing.writeScope.all'), value: TRANSACTIONS_WRITE_SCOPES.all },
  { label: t('pages.account.sharing.writeScope.own'), value: TRANSACTIONS_WRITE_SCOPES.own },
]);

const findPermissionOption = (value: SharePermission) =>
  permissionOptions.value.find((opt) => opt.value === value) ?? permissionOptions.value[0]!;
const findScopeOption = (value: TransactionsWriteScope) =>
  scopeOptions.value.find((opt) => opt.value === value) ?? scopeOptions.value[0]!;

const updateMemberMutation = useMutation({
  mutationFn: updateShareMember,
  onSuccess: () => {
    addSuccessNotification(t('pages.account.sharing.member.updateSuccess'));
    invalidateMembers();
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.account.sharing.member.updateError'))),
});

const handlePermissionChange = (member: ShareMemberRow, option: PermissionOption | null) => {
  if (!option || !member.shareId || option.value === member.permission) return;
  const nextPolicy =
    option.value === SHARE_PERMISSIONS.read
      ? null
      : { transactionsWriteScope: member.policy?.transactionsWriteScope ?? TRANSACTIONS_WRITE_SCOPES.all };
  updateMemberMutation.mutate({
    ...resourceArgs.value,
    userId: member.user.id,
    permission: option.value,
    policy: nextPolicy,
  });
};

const handleScopeChange = (member: ShareMemberRow, option: ScopeOption | null) => {
  if (!option || !member.shareId) return;
  if (member.policy?.transactionsWriteScope === option.value) return;
  updateMemberMutation.mutate({
    ...resourceArgs.value,
    userId: member.user.id,
    permission: member.permission,
    policy: { transactionsWriteScope: option.value },
  });
};

const revokeTarget = ref<ShareMemberRow | null>(null);
const revokeOpen = ref(false);
const openRevoke = (member: ShareMemberRow) => {
  revokeTarget.value = member;
  revokeOpen.value = true;
};

const revokeMutation = useMutation({
  mutationFn: revokeShareMember,
  onSuccess: () => {
    addSuccessNotification(t('pages.account.sharing.member.revokeSuccess'));
    invalidateMembers();
    revokeOpen.value = false;
    revokeTarget.value = null;
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.account.sharing.member.revokeError'))),
});

const confirmRevoke = () => {
  if (!revokeTarget.value) return;
  revokeMutation.mutate({ ...resourceArgs.value, userId: revokeTarget.value.user.id });
};

const cancelInviteTarget = ref<ShareInvitationModel | null>(null);
const cancelInviteOpen = ref(false);
const openCancelInvite = (invitation: ShareInvitationModel) => {
  cancelInviteTarget.value = invitation;
  cancelInviteOpen.value = true;
};

const cancelInviteMutation = useMutation({
  mutationFn: (id: string) => cancelShareInvitation(id),
  onSuccess: () => {
    addSuccessNotification(t('pages.account.sharing.pending.cancelSuccess'));
    invalidateInvitations();
    cancelInviteOpen.value = false;
    cancelInviteTarget.value = null;
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.account.sharing.pending.cancelError'))),
});

const confirmCancelInvite = () => {
  if (!cancelInviteTarget.value) return;
  cancelInviteMutation.mutate(cancelInviteTarget.value.id);
};

const resendInviteMutation = useMutation({
  mutationFn: (id: string) => resendShareInvitation(id),
  onSuccess: (data) => {
    if (data.emailOutcome === 'failed') {
      addErrorNotification(t('pages.account.sharing.pending.resendDeliveryFailed'));
    } else {
      addSuccessNotification(t('pages.account.sharing.pending.resendSuccess'));
    }
    invalidateInvitations();
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.account.sharing.pending.resendError'))),
});

const inviteDialogOpen = ref(false);
const isSelfRow = (member: ShareMemberRow) => user.value?.id === member.user.id;
</script>

<template>
  <div class="@container/sharing-panel grid gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-base font-medium">{{ $t('pages.account.sharing.title') }}</h3>
        <p class="text-muted-foreground text-sm">{{ $t('pages.account.sharing.description') }}</p>
      </div>

      <DemoRestricted v-if="isOwner" feature="share_account_invite">
        <Button variant="outline" size="sm" :disabled="isDemo" @click="inviteDialogOpen = true">
          <UserPlusIcon class="mr-2 size-4" />
          {{ $t('pages.account.sharing.inviteAnother') }}
        </Button>
      </DemoRestricted>
    </div>

    <div class="grid gap-2">
      <p class="text-muted-foreground text-xs tracking-wider uppercase">
        {{ $t('pages.account.sharing.membersHeading') }}
      </p>

      <template v-if="membersQuery.isLoading.value">
        <div class="grid gap-2">
          <div v-for="i in 2" :key="i" class="bg-muted h-16 w-full animate-pulse rounded-lg" />
        </div>
      </template>

      <template v-else-if="membersQuery.isError.value">
        <p class="text-destructive-text text-sm">{{ $t('pages.account.sharing.loadError') }}</p>
      </template>

      <template v-else>
        <template v-for="member in membersQuery.data.value?.members ?? []" :key="member.user.id">
          <div
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3 @xl/sharing-panel:flex-row @xl/sharing-panel:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium"
              >
                <UserIcon class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">
                  {{ member.user.username }}
                  <span v-if="isSelfRow(member)" class="text-muted-foreground ml-1 text-xs">
                    ({{ $t('pages.account.sharing.member.you') }})
                  </span>
                </p>
                <p class="text-muted-foreground text-xs">
                  <template v-if="member.role === 'owner'">{{ $t('pages.account.sharing.member.roleOwner') }}</template>
                  <template v-else>{{ $t('pages.account.sharing.member.roleRecipient') }}</template>
                </p>
              </div>
            </div>

            <template v-if="member.role === 'owner'">
              <div class="text-muted-foreground text-xs italic @xl/sharing-panel:ml-auto">
                {{ $t('pages.account.sharing.member.ownerHint') }}
              </div>
            </template>

            <template v-else>
              <div class="flex flex-wrap items-center gap-2 @xl/sharing-panel:ml-auto @xl/sharing-panel:flex-nowrap">
                <SelectField
                  :model-value="findPermissionOption(member.permission)"
                  :values="permissionOptions"
                  label-key="label"
                  value-key="value"
                  class="min-w-0 flex-1 basis-36 @xl/sharing-panel:w-36 @xl/sharing-panel:flex-none"
                  :disabled="updateMemberMutation.isPending.value || isSelfRow(member) || isDemo"
                  @update:model-value="(opt) => handlePermissionChange(member, opt as PermissionOption | null)"
                />
                <SelectField
                  v-if="member.permission !== SHARE_PERMISSIONS.read"
                  :model-value="findScopeOption(member.policy?.transactionsWriteScope ?? TRANSACTIONS_WRITE_SCOPES.all)"
                  :values="scopeOptions"
                  label-key="label"
                  value-key="value"
                  class="min-w-0 flex-1 basis-44 @xl/sharing-panel:w-44 @xl/sharing-panel:flex-none"
                  :disabled="updateMemberMutation.isPending.value || isSelfRow(member) || isDemo"
                  @update:model-value="(opt) => handleScopeChange(member, opt as ScopeOption | null)"
                />
                <DemoRestricted feature="share_account_revoke_member">
                  <DesktopOnlyTooltip :content="$t('pages.account.sharing.member.revoke')">
                    <Button
                      variant="soft-destructive"
                      size="icon-sm"
                      :disabled="isSelfRow(member) || revokeMutation.isPending.value || isDemo"
                      @click="openRevoke(member)"
                    >
                      <Trash2Icon class="size-4" />
                    </Button>
                  </DesktopOnlyTooltip>
                </DemoRestricted>
              </div>
            </template>
          </div>
        </template>
      </template>
    </div>

    <div v-if="isOwner" class="grid gap-2">
      <p class="text-muted-foreground text-xs tracking-wider uppercase">
        {{ $t('pages.account.sharing.pendingHeading') }}
      </p>

      <template v-if="sentInvitationsQuery.isLoading.value">
        <div class="bg-muted h-14 w-full animate-pulse rounded-lg" />
      </template>

      <template v-else-if="!pendingInvitationsForAccount.length">
        <p class="text-muted-foreground text-sm">{{ $t('pages.account.sharing.pending.empty') }}</p>
      </template>

      <template v-else>
        <template v-for="invitation in pendingInvitationsForAccount" :key="invitation.id">
          <div
            class="border-border bg-card flex flex-col gap-3 rounded-lg border p-3 @sm/sharing-panel:flex-row @sm/sharing-panel:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                <MailIcon class="size-4" />
              </div>
              <div class="min-w-0">
                <DesktopOnlyTooltip :content="invitation.inviteeEmail">
                  <p class="block max-w-55 truncate text-sm font-medium">{{ invitation.inviteeEmail }}</p>
                </DesktopOnlyTooltip>

                <p class="text-muted-foreground text-xs">
                  {{ $t(`pages.account.sharing.permissions.${invitation.permission}`) }}
                </p>
                <p v-if="!invitation.emailConfigured" class="text-warning text-xs">
                  {{ $t('common.sharing.emailNotSent') }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 @sm/sharing-panel:ml-auto">
              <DesktopOnlyTooltip :content="$t('common.actions.copyInviteLink')">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  @click="copyInviteLink({ token: invitation.token, resourceType: invitation.resourceType })"
                >
                  <CopyIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
              <DemoRestricted v-if="invitation.emailConfigured" feature="share_account_resend_invite">
                <DesktopOnlyTooltip :content="$t('pages.account.sharing.pending.resend')">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :disabled="resendInviteMutation.isPending.value || isDemo"
                    @click="resendInviteMutation.mutate(invitation.id)"
                  >
                    <RotateCwIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </DemoRestricted>
              <DemoRestricted feature="share_account_cancel_invite">
                <DesktopOnlyTooltip :content="$t('pages.account.sharing.pending.cancel')">
                  <Button
                    variant="ghost-destructive"
                    size="icon-sm"
                    :disabled="cancelInviteMutation.isPending.value || isDemo"
                    @click="openCancelInvite(invitation)"
                  >
                    <XIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </DemoRestricted>
            </div>
          </div>
        </template>
      </template>
    </div>

    <ShareAccountDialog v-if="isOwner" v-model:open="inviteDialogOpen" :account="account" />

    <ResponsiveAlertDialog
      v-model:open="revokeOpen"
      :confirm-label="$t('pages.account.sharing.member.revokeConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="revokeMutation.isPending.value || isDemo"
      @confirm="confirmRevoke"
    >
      <template #title>{{ $t('pages.account.sharing.member.revokeTitle') }}</template>
      <template #description>
        {{
          $t('pages.account.sharing.member.revokeDescription', {
            user: revokeTarget?.user.username ?? '',
            account: account.name,
          })
        }}
      </template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="cancelInviteOpen"
      :confirm-label="$t('pages.account.sharing.pending.cancelConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="cancelInviteMutation.isPending.value || isDemo"
      @confirm="confirmCancelInvite"
    >
      <template #title>{{ $t('pages.account.sharing.pending.cancelTitle') }}</template>
      <template #description>
        {{ $t('pages.account.sharing.pending.cancelDescription', { email: cancelInviteTarget?.inviteeEmail ?? '' }) }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
