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
import ShareBudgetDialog from '@/components/dialogs/share-budget-dialog.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { useCopyInviteLink } from '@/composable/use-copy-invite-link';
import { ApiErrorResponseError } from '@/js/errors';
import { useUserStore } from '@/stores';
import {
  type BudgetModel,
  RESOURCE_TYPES,
  SHARE_INVITATION_STATUSES,
  SHARE_PERMISSIONS,
  type ShareInvitationModel,
  type SharePermission,
} from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CopyIcon, MailIcon, RotateCwIcon, Trash2Icon, UserIcon, UserPlusIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Budget-side sharing panel. Mirrors `account/components/sharing-panel/sharing-panel.vue`
 * but drops the per-tx write-scope selector (budgets have no `transactionsWriteScope`
 * policy in MVP — `write` = "attach own transactions", nothing else). Owner and `manage`
 * recipients see the full members list + invite button; non-manage recipients see
 * nothing (the panel mounts behind a `canManage` gate at the call site).
 */

const props = defineProps<{
  budget: BudgetModel;
}>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { copyInviteLink } = useCopyInviteLink();
const queryClient = useQueryClient();
const { user, isDemo } = storeToRefs(useUserStore());

const { isOwner, canManage } = useBudgetAccess(toRef(() => props.budget));

const resourceArgs = computed(() => ({
  resourceType: RESOURCE_TYPES.budget,
  resourceId: props.budget.id,
}));

const membersQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.budget, props.budget.id]),
  queryFn: () => listShareMembers(resourceArgs.value),
  enabled: canManage,
});

const sentInvitationsQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent,
  queryFn: () => listSentShareInvitations(),
  enabled: isOwner,
});

const pendingInvitationsForBudget = computed(() => {
  if (!sentInvitationsQuery.data.value) return [];
  return sentInvitationsQuery.data.value.filter(
    (inv) =>
      inv.resourceType === RESOURCE_TYPES.budget &&
      String(inv.resourceId) === resourceArgs.value.resourceId &&
      inv.status === SHARE_INVITATION_STATUSES.pending,
  );
});

const invalidateMembers = () =>
  queryClient.invalidateQueries({
    queryKey: [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.budget, props.budget.id],
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
  { label: t('pages.budgetDetails.sharing.permissions.read'), value: SHARE_PERMISSIONS.read },
  { label: t('pages.budgetDetails.sharing.permissions.write'), value: SHARE_PERMISSIONS.write },
  { label: t('pages.budgetDetails.sharing.permissions.manage'), value: SHARE_PERMISSIONS.manage },
]);

const findPermissionOption = (value: SharePermission) =>
  permissionOptions.value.find((opt) => opt.value === value) ?? permissionOptions.value[0]!;

const updateMemberMutation = useMutation({
  mutationFn: updateShareMember,
  onSuccess: () => {
    addSuccessNotification(t('pages.budgetDetails.sharing.member.updateSuccess'));
    invalidateMembers();
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.budgetDetails.sharing.member.updateError'))),
});

const handlePermissionChange = (member: ShareMemberRow, option: PermissionOption | null) => {
  if (!option || !member.shareId || option.value === member.permission) return;
  // Budgets have no per-tx scope policy — always send `policy: null`.
  updateMemberMutation.mutate({
    ...resourceArgs.value,
    userId: member.user.id,
    permission: option.value,
    policy: null,
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
    addSuccessNotification(t('pages.budgetDetails.sharing.member.revokeSuccess'));
    invalidateMembers();
    revokeOpen.value = false;
    revokeTarget.value = null;
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.budgetDetails.sharing.member.revokeError'))),
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
    addSuccessNotification(t('pages.budgetDetails.sharing.pending.cancelSuccess'));
    invalidateInvitations();
    cancelInviteOpen.value = false;
    cancelInviteTarget.value = null;
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.budgetDetails.sharing.pending.cancelError'))),
});

const confirmCancelInvite = () => {
  if (!cancelInviteTarget.value) return;
  cancelInviteMutation.mutate(cancelInviteTarget.value.id);
};

const resendInviteMutation = useMutation({
  mutationFn: (id: string) => resendShareInvitation(id),
  onSuccess: (data) => {
    if (data.emailOutcome === 'failed') {
      addErrorNotification(t('pages.budgetDetails.sharing.pending.resendDeliveryFailed'));
    } else {
      addSuccessNotification(t('pages.budgetDetails.sharing.pending.resendSuccess'));
    }
    invalidateInvitations();
  },
  onError: (err) => addErrorNotification(apiErrorMessage(err, t('pages.budgetDetails.sharing.pending.resendError'))),
});

const inviteDialogOpen = ref(false);
const isSelfRow = (member: ShareMemberRow) => user.value?.id === member.user.id;
</script>

<template>
  <div class="@container/sharing-panel grid gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-base font-medium">{{ $t('pages.budgetDetails.sharing.title') }}</h3>
        <p class="text-muted-foreground text-sm">{{ $t('pages.budgetDetails.sharing.description') }}</p>
      </div>

      <DemoRestricted v-if="isOwner" feature="share_budget_invite">
        <Button variant="outline" size="sm" :disabled="isDemo" @click="inviteDialogOpen = true">
          <UserPlusIcon class="mr-2 size-4" />
          {{ $t('pages.budgetDetails.sharing.inviteAnother') }}
        </Button>
      </DemoRestricted>
    </div>

    <div class="grid gap-2">
      <p class="text-muted-foreground text-xs tracking-wider uppercase">
        {{ $t('pages.budgetDetails.sharing.membersHeading') }}
      </p>

      <template v-if="membersQuery.isLoading.value">
        <div class="grid gap-2">
          <div v-for="i in 2" :key="i" class="bg-muted h-16 w-full animate-pulse rounded-lg" />
        </div>
      </template>

      <template v-else-if="membersQuery.isError.value">
        <p class="text-destructive-text text-sm">{{ $t('pages.budgetDetails.sharing.loadError') }}</p>
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
                    ({{ $t('pages.budgetDetails.sharing.member.you') }})
                  </span>
                </p>
                <p class="text-muted-foreground text-xs">
                  <template v-if="member.role === 'owner'">
                    {{ $t('pages.budgetDetails.sharing.member.roleOwner') }}
                  </template>
                  <template v-else>{{ $t('pages.budgetDetails.sharing.member.roleRecipient') }}</template>
                </p>
              </div>
            </div>

            <template v-if="member.role === 'owner'">
              <div class="text-muted-foreground text-xs italic @xl/sharing-panel:ml-auto">
                {{ $t('pages.budgetDetails.sharing.member.ownerHint') }}
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
                <DemoRestricted feature="share_budget_revoke_member">
                  <DesktopOnlyTooltip :content="$t('pages.budgetDetails.sharing.member.revoke')">
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
        {{ $t('pages.budgetDetails.sharing.pendingHeading') }}
      </p>

      <template v-if="sentInvitationsQuery.isLoading.value">
        <div class="bg-muted h-14 w-full animate-pulse rounded-lg" />
      </template>

      <template v-else-if="!pendingInvitationsForBudget.length">
        <p class="text-muted-foreground text-sm">{{ $t('pages.budgetDetails.sharing.pending.empty') }}</p>
      </template>

      <template v-else>
        <template v-for="invitation in pendingInvitationsForBudget" :key="invitation.id">
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
                  {{ $t(`pages.budgetDetails.sharing.permissions.${invitation.permission}`) }}
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
              <DemoRestricted v-if="invitation.emailConfigured" feature="share_budget_resend_invite">
                <DesktopOnlyTooltip :content="$t('pages.budgetDetails.sharing.pending.resend')">
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
              <DemoRestricted feature="share_budget_cancel_invite">
                <DesktopOnlyTooltip :content="$t('pages.budgetDetails.sharing.pending.cancel')">
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

    <ShareBudgetDialog v-if="isOwner" v-model:open="inviteDialogOpen" :budget="budget" />

    <ResponsiveAlertDialog
      v-model:open="revokeOpen"
      :confirm-label="$t('pages.budgetDetails.sharing.member.revokeConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="revokeMutation.isPending.value || isDemo"
      @confirm="confirmRevoke"
    >
      <template #title>{{ $t('pages.budgetDetails.sharing.member.revokeTitle') }}</template>
      <template #description>
        {{
          $t('pages.budgetDetails.sharing.member.revokeDescription', {
            user: revokeTarget?.user.username ?? '',
            budget: budget.name,
          })
        }}
      </template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="cancelInviteOpen"
      :confirm-label="$t('pages.budgetDetails.sharing.pending.cancelConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="cancelInviteMutation.isPending.value || isDemo"
      @confirm="confirmCancelInvite"
    >
      <template #title>{{ $t('pages.budgetDetails.sharing.pending.cancelTitle') }}</template>
      <template #description>
        {{
          $t('pages.budgetDetails.sharing.pending.cancelDescription', { email: cancelInviteTarget?.inviteeEmail ?? '' })
        }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
