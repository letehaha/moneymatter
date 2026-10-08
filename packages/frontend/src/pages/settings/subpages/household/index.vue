<script setup lang="ts">
import {
  type ShareMemberRow,
  cancelShareInvitation,
  createShareInvitation,
  leaveShare,
  listShareMembers,
  listSentShareInvitations,
  listSharedWithMe,
  resendShareInvitation,
  revokeShareMember,
  updateShareMember,
} from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Separator } from '@/components/lib/ui/separator';
import { useNotificationCenter } from '@/components/notification-center';
import { useCopyInviteLink } from '@/composable/use-copy-invite-link';
import { extractApiErrorMessage } from '@/js/errors';
import { useUserStore } from '@/stores';
import { useOnboardingStore } from '@/stores/onboarding';
import {
  RESOURCE_TYPES,
  SHARE_INVITATION_STATUSES,
  SHARE_PERMISSIONS,
  type SharePermission,
  type ShareInvitationModel,
  TRANSACTIONS_WRITE_SCOPES,
  type TransactionsWriteScope,
} from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CopyIcon, LogOutIcon, MailIcon, RotateCwIcon, UserMinusIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { user, isDemo } = storeToRefs(useUserStore());
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { copyInviteLink } = useCopyInviteLink();
const queryClient = useQueryClient();
const onboardingStore = useOnboardingStore();

// "My household" = the household I own. Identified by my own userId in the resource shape.
const myHouseholdId = computed(() => user.value?.id ?? null);

// Permissions are constrained to `read` / `write` for household members (DB CHECK enforces
// this), but a stale row could still surface another value through the API. Use a typed
// lookup with a safe fallback so the UI never renders a raw i18n key like
// `pages.household.permissions.manage` to the user.
const permissionLabel = (permission: string): string => {
  if (permission === SHARE_PERMISSIONS.read) return t('pages.household.permissions.read');
  if (permission === SHARE_PERMISSIONS.write) return t('pages.household.permissions.write');
  return permission;
};

interface PermissionOption {
  label: string;
  value: SharePermission;
}
interface WriteScopeOption {
  label: string;
  value: TransactionsWriteScope;
}

// Household memberships never carry `manage` — DB CHECK constraints enforce this. The
// owner is implicit (caller) and stays `manage` via the auth resolver, but we don't show
// it as an assignable option.
const permissionOptions = computed<PermissionOption[]>(() => [
  { label: t('pages.household.permissions.read'), value: SHARE_PERMISSIONS.read },
  { label: t('pages.household.permissions.write'), value: SHARE_PERMISSIONS.write },
]);

const writeScopeOptions = computed<WriteScopeOption[]>(() => [
  { label: t('pages.household.writeScope.all'), value: TRANSACTIONS_WRITE_SCOPES.all },
  { label: t('pages.household.writeScope.own'), value: TRANSACTIONS_WRITE_SCOPES.own },
]);

const membersQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.household, myHouseholdId.value]),
  queryFn: () =>
    listShareMembers({
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(myHouseholdId.value),
    }),
  enabled: computed(() => myHouseholdId.value !== null),
});

const sharedWithMeQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe,
  queryFn: listSharedWithMe,
});

const householdsImIn = computed(() =>
  (sharedWithMeQuery.data.value ?? []).filter((row) => row.resourceType === RESOURCE_TYPES.household),
);

// Recipient rows only — owner row is rendered separately at the top of the section.
const recipientMembers = computed(() => (membersQuery.data.value?.members ?? []).filter((m) => m.role === 'recipient'));
const ownerMember = computed(() => (membersQuery.data.value?.members ?? []).find((m) => m.role === 'owner') ?? null);

const sentInvitationsQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent,
  queryFn: listSentShareInvitations,
  enabled: computed(() => myHouseholdId.value !== null),
});

// Pending household invites the caller has sent. The list-sent endpoint already scopes
// to the caller as owner, so we only need to narrow by resource shape + status.
const pendingInvitations = computed(() => {
  if (!sentInvitationsQuery.data.value || myHouseholdId.value === null) return [];
  const householdResourceId = String(myHouseholdId.value);
  return sentInvitationsQuery.data.value.filter(
    (inv) =>
      inv.resourceType === RESOURCE_TYPES.household &&
      String(inv.resourceId) === householdResourceId &&
      inv.status === SHARE_INVITATION_STATUSES.pending,
  );
});

// ─── Invite form ─────────────────────────────────────────────────────────
const inviteEmail = ref('');
const invitePermission = ref<PermissionOption>(permissionOptions.value[1]!); // default write
const inviteWriteScope = ref<WriteScopeOption>(writeScopeOptions.value[0]!);

const showsWriteScope = computed(() => invitePermission.value.value !== SHARE_PERMISSIONS.read);
const isInviteEmailValid = computed(() => /.+@.+\..+/.test(inviteEmail.value.trim()));

const inviteMutation = useMutation({
  mutationFn: () => {
    if (myHouseholdId.value === null) {
      // Guard against a logout race between submit and mutation execute — without this we'd
      // POST `resourceId: null` and surface a 500 from the DB CHECK rather than a clean abort.
      throw new Error('No household context for invite');
    }
    return createShareInvitation({
      inviteeEmail: inviteEmail.value.trim(),
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(myHouseholdId.value),
      permission: invitePermission.value.value,
      policy: showsWriteScope.value ? { transactionsWriteScope: inviteWriteScope.value.value } : null,
    });
  },
  onSuccess: (data) => {
    if (data.emailOutcome === 'failed') {
      addErrorNotification(t('pages.household.invite.emailDeliveryFailed'));
    } else {
      addSuccessNotification(t('pages.household.invite.sent'));
    }
    inviteEmail.value = '';
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });
    onboardingStore.completeTask('invite-household-member');
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.invite.error'));
  },
});

const submitInvite = () => {
  if (!isInviteEmailValid.value || !myHouseholdId.value) return;
  inviteMutation.mutate();
};

// ─── Revoke ──────────────────────────────────────────────────────────────
const revokeTarget = ref<ShareMemberRow | null>(null);
const revokeOpen = ref(false);
const openRevoke = (member: ShareMemberRow) => {
  revokeTarget.value = member;
  revokeOpen.value = true;
};
const revokeMutation = useMutation({
  mutationFn: () => {
    if (myHouseholdId.value === null || !revokeTarget.value) {
      // Guard against a logout race where the user store cleared between open + confirm —
      // without this we'd POST `resourceId: "null"` which the DB CHECK rejects with a 500.
      throw new Error('No household context for revoke');
    }
    return revokeShareMember({
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(myHouseholdId.value),
      userId: revokeTarget.value.user.id,
    });
  },
  onSuccess: () => {
    addSuccessNotification(t('pages.household.revoke.success'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareMembers });
    revokeOpen.value = false;
    revokeTarget.value = null;
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.revoke.error'));
  },
});
const confirmRevoke = () => {
  if (!revokeTarget.value) return;
  revokeMutation.mutate();
};

// ─── Pending invites (resend / cancel) ────────────────────────────────────
const cancelInviteTarget = ref<ShareInvitationModel | null>(null);
const cancelInviteOpen = ref(false);
const openCancelInvite = (invitation: ShareInvitationModel) => {
  cancelInviteTarget.value = invitation;
  cancelInviteOpen.value = true;
};
const cancelInviteMutation = useMutation({
  mutationFn: (id: string) => cancelShareInvitation(id),
  onSuccess: () => {
    addSuccessNotification(t('pages.household.pending.cancelSuccess'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });
    cancelInviteOpen.value = false;
    cancelInviteTarget.value = null;
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.pending.cancelError'));
  },
});
const confirmCancelInvite = () => {
  if (!cancelInviteTarget.value) return;
  cancelInviteMutation.mutate(cancelInviteTarget.value.id);
};
const resendInviteMutation = useMutation({
  mutationFn: (id: string) => resendShareInvitation(id),
  onSuccess: (data) => {
    if (data.emailOutcome === 'failed') {
      addErrorNotification(t('pages.household.pending.resendDeliveryFailed'));
    } else {
      addSuccessNotification(t('pages.household.pending.resendSuccess'));
    }
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.pending.resendError'));
  },
});

// ─── Permission change ────────────────────────────────────────────────────
const changePermissionMutation = useMutation({
  mutationFn: ({ userId, permission }: { userId: number; permission: SharePermission }) => {
    if (myHouseholdId.value === null) {
      throw new Error('No household context for permission change');
    }
    return updateShareMember({
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(myHouseholdId.value),
      userId,
      permission,
    });
  },
  onSuccess: () => {
    addSuccessNotification(t('pages.household.permissionChange.success'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareMembers });
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.permissionChange.error'));
  },
});

// ─── Leave (recipient side) ──────────────────────────────────────────────
const leaveTarget = ref<{ resourceId: string; ownerName: string } | null>(null);
const leaveOpen = ref(false);
const openLeave = ({ resourceId, ownerName }: { resourceId: string; ownerName: string }) => {
  leaveTarget.value = { resourceId, ownerName };
  leaveOpen.value = true;
};
const leaveMutation = useMutation({
  mutationFn: () =>
    leaveShare({
      resourceType: RESOURCE_TYPES.household,
      resourceId: leaveTarget.value!.resourceId,
    }),
  onSuccess: () => {
    addSuccessNotification(t('pages.household.leave.success'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
    leaveOpen.value = false;
    leaveTarget.value = null;
  },
  onError: (err) => {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.household.leave.error'));
  },
});
const confirmLeave = () => {
  if (!leaveTarget.value) return;
  leaveMutation.mutate();
};

// Keep the permission select default in sync if the i18n labels swap (e.g. on locale change).
watch(permissionOptions, (next) => {
  invitePermission.value = next.find((o) => o.value === invitePermission.value.value) ?? next[1]!;
});
</script>

<template>
  <div class="grid gap-6">
    <Card class="@container/household max-w-4xl">
      <CardHeader class="border-b">
        <h2 class="mb-2 text-2xl font-semibold">{{ $t('pages.household.title') }}</h2>
        <p class="text-sm opacity-80">{{ $t('pages.household.description') }}</p>
      </CardHeader>

      <CardContent class="mt-6 flex flex-col gap-6">
        <!-- ─── My household ─── -->
        <section>
          <h3 class="mb-2 text-lg font-medium">{{ $t('pages.household.myHousehold.title') }}</h3>
          <p class="text-muted-foreground mb-4 text-sm leading-relaxed">
            {{ $t('pages.household.myHousehold.description') }}
          </p>

          <!-- Invite form -->
          <form class="mb-6 grid gap-3 @sm/household:grid-cols-[1fr_auto_auto]" @submit.prevent="submitInvite">
            <InputField
              v-model="inviteEmail"
              type="email"
              :placeholder="$t('pages.household.invite.emailPlaceholder')"
              :label="$t('pages.household.invite.emailLabel')"
            />
            <SelectField
              v-model="invitePermission"
              :values="permissionOptions"
              :label="$t('pages.household.invite.permissionLabel')"
              label-key="label"
              value-key="value"
            />
            <SelectField
              v-if="showsWriteScope"
              v-model="inviteWriteScope"
              :values="writeScopeOptions"
              :label="$t('pages.household.invite.writeScopeLabel')"
              label-key="label"
              value-key="value"
            />
            <Button
              type="submit"
              :disabled="!isInviteEmailValid || inviteMutation.isPending.value || isDemo"
              class="@sm/household:col-span-3"
            >
              <MailIcon class="mr-2 size-4" />
              {{ $t('pages.household.invite.submit') }}
            </Button>
          </form>

          <!-- Member list -->
          <div v-if="membersQuery.isLoading.value" class="grid gap-2">
            <div v-for="i in 2" :key="i" class="bg-muted h-14 w-full animate-pulse rounded-md" />
          </div>
          <div v-else-if="membersQuery.isError.value" class="text-destructive-text text-sm">
            {{ $t('pages.household.loadMembersError') }}
          </div>
          <template v-else>
            <div v-if="ownerMember" class="border-border bg-card/60 mb-2 flex items-center gap-3 rounded-md border p-3">
              <div
                class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-full"
              >
                {{ ownerMember.user.username.slice(0, 1).toUpperCase() }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">@{{ ownerMember.user.username }}</p>
                <p class="text-muted-foreground text-xs">{{ $t('pages.household.youOwner') }}</p>
              </div>
            </div>

            <div
              v-if="!recipientMembers.length && !pendingInvitations.length"
              class="text-muted-foreground py-4 text-sm"
            >
              {{ $t('pages.household.noMembers') }}
            </div>
            <ul v-else class="grid gap-2">
              <li
                v-for="member in recipientMembers"
                :key="`member-${member.shareId ?? member.user.id}`"
                class="border-border bg-card flex flex-col gap-3 rounded-md border p-3 @sm/household:flex-row @sm/household:items-center"
              >
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-full"
                  >
                    {{ member.user.username.slice(0, 1).toUpperCase() }}
                  </div>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">@{{ member.user.username }}</p>
                    <p class="text-muted-foreground text-xs">
                      {{ permissionLabel(member.permission) }}
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <DemoRestricted feature="household_change_permission">
                    <Button
                      v-if="member.permission !== SHARE_PERMISSIONS.read"
                      size="sm"
                      variant="outline"
                      :disabled="changePermissionMutation.isPending.value || isDemo"
                      @click="
                        changePermissionMutation.mutate({ userId: member.user.id, permission: SHARE_PERMISSIONS.read })
                      "
                    >
                      {{ $t('pages.household.permissionChange.setRead') }}
                    </Button>
                    <Button
                      v-else
                      size="sm"
                      variant="outline"
                      :disabled="changePermissionMutation.isPending.value || isDemo"
                      @click="
                        changePermissionMutation.mutate({ userId: member.user.id, permission: SHARE_PERMISSIONS.write })
                      "
                    >
                      {{ $t('pages.household.permissionChange.setWrite') }}
                    </Button>
                  </DemoRestricted>
                  <DemoRestricted feature="household_revoke_member">
                    <Button
                      size="sm"
                      variant="soft-destructive"
                      :disabled="revokeMutation.isPending.value || isDemo"
                      @click="openRevoke(member)"
                    >
                      <UserMinusIcon class="mr-2 size-4" />
                      {{ $t('pages.household.revoke.action') }}
                    </Button>
                  </DemoRestricted>
                </div>
              </li>
              <li
                v-for="invitation in pendingInvitations"
                :key="`invite-${invitation.id}`"
                class="border-border bg-card flex flex-col gap-3 rounded-md border p-3 @sm/household:flex-row @sm/household:items-center"
              >
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
                  >
                    <MailIcon class="size-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">{{ invitation.inviteeEmail }}</p>
                    <p class="text-muted-foreground text-xs">
                      <span>{{ permissionLabel(invitation.permission) }}</span>
                      <span
                        class="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-[10px] tracking-wide uppercase"
                      >
                        {{ $t('pages.household.pending.badge') }}
                      </span>
                    </p>
                    <p v-if="!invitation.emailConfigured" class="text-warning text-xs">
                      {{ $t('common.sharing.emailNotSent') }}
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    @click="copyInviteLink({ token: invitation.token, resourceType: invitation.resourceType })"
                  >
                    <CopyIcon class="size-4" />
                    {{ $t('common.actions.copyInviteLink') }}
                  </Button>
                  <DemoRestricted v-if="invitation.emailConfigured" feature="household_resend_invite">
                    <Button
                      size="sm"
                      variant="outline"
                      :loading="resendInviteMutation.isPending.value"
                      :disabled="resendInviteMutation.isPending.value || isDemo"
                      @click="resendInviteMutation.mutate(invitation.id)"
                    >
                      <RotateCwIcon class="mr-2 size-4" />
                      {{ $t('pages.household.pending.resend') }}
                    </Button>
                  </DemoRestricted>
                  <DemoRestricted feature="household_cancel_invite">
                    <Button
                      size="sm"
                      variant="soft-destructive"
                      :disabled="cancelInviteMutation.isPending.value || isDemo"
                      @click="openCancelInvite(invitation)"
                    >
                      <XIcon class="mr-2 size-4" />
                      {{ $t('pages.household.pending.cancel') }}
                    </Button>
                  </DemoRestricted>
                </div>
              </li>
            </ul>
          </template>
        </section>

        <Separator />

        <!-- ─── Households I'm in ─── -->
        <section>
          <h3 class="mb-2 text-lg font-medium">{{ $t('pages.household.imIn.title') }}</h3>
          <p class="text-muted-foreground mb-4 text-sm leading-relaxed">
            {{ $t('pages.household.imIn.description') }}
          </p>

          <div v-if="sharedWithMeQuery.isLoading.value" class="grid gap-2">
            <div v-for="i in 2" :key="`sw-${i}`" class="bg-muted h-14 w-full animate-pulse rounded-md" />
          </div>
          <div v-else-if="sharedWithMeQuery.isError.value" class="text-destructive-text py-4 text-sm">
            {{ $t('pages.household.imIn.loadError') }}
          </div>
          <div v-else-if="!householdsImIn.length" class="text-muted-foreground py-4 text-sm">
            {{ $t('pages.household.imIn.empty') }}
          </div>
          <ul v-else class="grid gap-2">
            <li
              v-for="row in householdsImIn"
              :key="row.shareId"
              class="border-border bg-card flex flex-col gap-3 rounded-md border p-3 @sm/household:flex-row @sm/household:items-center"
            >
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <div
                  class="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-full"
                >
                  {{ row.owner.username.slice(0, 1).toUpperCase() }}
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{
                      row.resourceName ?? $t('pages.household.imIn.unnamedHousehold', { handle: row.owner.username })
                    }}
                  </p>
                  <p class="text-muted-foreground text-xs">
                    {{ permissionLabel(row.permission) }}
                  </p>
                </div>
              </div>
              <DemoRestricted feature="household_leave">
                <Button
                  size="sm"
                  variant="soft-destructive"
                  :disabled="leaveMutation.isPending.value || isDemo"
                  @click="openLeave({ resourceId: row.resourceId, ownerName: row.owner.username })"
                >
                  <LogOutIcon class="mr-2 size-4" />
                  {{ $t('pages.household.leave.action') }}
                </Button>
              </DemoRestricted>
            </li>
          </ul>
        </section>
      </CardContent>
    </Card>

    <ResponsiveAlertDialog
      v-model:open="revokeOpen"
      :confirm-label="$t('pages.household.revoke.confirm')"
      confirm-variant="destructive"
      :confirm-disabled="revokeMutation.isPending.value || isDemo"
      @confirm="confirmRevoke"
    >
      <template #title>{{ $t('pages.household.revoke.title') }}</template>
      <template #description>
        {{ $t('pages.household.revoke.description', { handle: revokeTarget?.user.username ?? '' }) }}
      </template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="leaveOpen"
      :confirm-label="$t('pages.household.leave.confirm')"
      confirm-variant="destructive"
      :confirm-disabled="leaveMutation.isPending.value || isDemo"
      @confirm="confirmLeave"
    >
      <template #title>{{ $t('pages.household.leave.title') }}</template>
      <template #description>
        {{ $t('pages.household.leave.description', { owner: leaveTarget?.ownerName ?? '' }) }}
      </template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="cancelInviteOpen"
      :confirm-label="$t('pages.household.pending.cancelConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="cancelInviteMutation.isPending.value || isDemo"
      @confirm="confirmCancelInvite"
    >
      <template #title>{{ $t('pages.household.pending.cancelTitle') }}</template>
      <template #description>
        {{ $t('pages.household.pending.cancelDescription', { email: cancelInviteTarget?.inviteeEmail ?? '' }) }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
