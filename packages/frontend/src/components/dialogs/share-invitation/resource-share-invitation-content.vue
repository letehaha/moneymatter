<script setup lang="ts">
import { acceptShareInvitation, declineShareInvitation } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useCategoriesStore, useUserStore } from '@/stores';
import { RESOURCE_TYPES, ResourceType } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { CheckCircleIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type InvitationLike, extractApiError, formatExpiry, permissionLabel } from './utils';

/**
 * Per-resource invitation body + footer (currently `account`). The wrapper resolves
 * the pending invitation, picks this component for `resourceType === 'account'`,
 * and hands ownership of accept/decline mutations to the child so household state
 * (back-invite, currency-mismatch) doesn't leak into the per-resource path.
 *
 * Footer-row stays inline rather than going through `ResponsiveDialog`'s `#footer`
 * slot — a nested component can't fill a parent's named slot in Vue 3, and the
 * inline row keeps DialogFooter's classes so the visual layout matches.
 */

const props = defineProps<{
  invitation: InvitationLike;
}>();

const emit = defineEmits<{
  close: [];
  accepted: [{ acceptedAccountId: string | null }];
  declined: [];
}>();

const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const categoriesStore = useCategoriesStore();
const { isDemo } = storeToRefs(useUserStore());

type ChildState = 'pending' | 'accepted' | 'declined' | 'error';
const childState = ref<ChildState>('pending');
/**
 * Captured at accept-time so the "go to resource" button can route to the right page
 * even after the dialog rerenders. `null` while pending; populated to the just-accepted
 * resource on success. Account / tracker are routed to their respective detail pages;
 * other resource types fall through to a generic "close" action.
 */
const acceptedResource = ref<{ type: ResourceType; id: string } | null>(null);
const acceptedAccountId = computed(() =>
  acceptedResource.value?.type === RESOURCE_TYPES.account ? acceptedResource.value.id : null,
);

const acceptMutation = useMutation({
  mutationFn: () => acceptShareInvitation(props.invitation.token),
  onSuccess: async (data) => {
    childState.value = 'accepted';
    acceptedResource.value = { type: data.share.resourceType, id: data.share.resourceId };
    emit('accepted', { acceptedAccountId: acceptedAccountId.value });
    addSuccessNotification(t('dialogs.shareInvitationDialog.acceptSuccess'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
    if (data.share.resourceType === RESOURCE_TYPES.tracker) {
      // Newly accepted tracker surfaces in the owned+shared tracker list — invalidate the
      // list query and the per-tracker detail query (in case the user opens the tracker
      // before the list refetches).
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.trackersList });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.trackersListItem });
    } else {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
    }
    // Refetch accounts and reload categories in parallel — the newly accessible accounts
    // carry transactions whose categoryId points at the owner's category tree, which the
    // categories store only pulls in on (re)load. Without this, tx rows render with broken
    // category chips until a page reload. Wrapped in try/catch so a refetch failure
    // doesn't reject the mutation (which would re-fire onError after we already showed
    // the accepted state and the success toast).
    try {
      await Promise.all([accountsStore.refetchAccounts(), categoriesStore.loadCategories({ force: true })]);
    } catch (refreshErr) {
      addErrorNotification(t('dialogs.shareInvitationDialog.acceptDataRefreshFailed'));
      captureException({ error: refreshErr, context: { source: 'shareInvitationAcceptDataRefresh' } });
    }
  },
  onError: (err: unknown) => {
    const { message } = extractApiError(err);
    addErrorNotification(message || t('dialogs.shareInvitationDialog.acceptError'));
    childState.value = 'error';
  },
});

const declineMutation = useMutation({
  mutationFn: () => declineShareInvitation(props.invitation.token),
  onSuccess: () => {
    childState.value = 'declined';
    addSuccessNotification(t('dialogs.shareInvitationDialog.declineSuccess'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
    emit('declined');
  },
  onError: (err: unknown) => {
    const { message } = extractApiError(err);
    addErrorNotification(message || t('dialogs.shareInvitationDialog.declineError'));
  },
});

const goToResource = () => {
  const accepted = acceptedResource.value;
  if (!accepted) {
    emit('close');
    return;
  }
  if (accepted.type === RESOURCE_TYPES.account) {
    router.push({ name: ROUTES_NAMES.account, params: { id: accepted.id } });
    return;
  }
  if (accepted.type === RESOURCE_TYPES.tracker) {
    router.push({ name: ROUTES_NAMES.plannedTrackerDetails, params: { id: accepted.id } });
    return;
  }
  emit('close');
};

const goToResourceLabel = computed(() => {
  if (acceptedResource.value?.type === RESOURCE_TYPES.tracker) {
    return t('dialogs.shareInvitationDialog.goToBudget');
  }
  return t('dialogs.shareInvitationDialog.goToAccount');
});

const closeDialog = () => emit('close');
</script>

<template>
  <div class="flex flex-col gap-6">
    <h2 class="text-center text-xl font-semibold">
      <template v-if="childState === 'pending'">
        <i18n-t keypath="dialogs.shareInvitationDialog.titlePending" tag="span">
          <template #owner>
            <span class="text-primary-text">
              {{ invitation.owner?.username || $t('dialogs.shareInvitationDialog.unknownOwner') }}
            </span>
          </template>
        </i18n-t>
      </template>
      <template v-else-if="childState === 'accepted'">
        {{ $t('dialogs.shareInvitationDialog.titleAccepted') }}
      </template>
      <template v-else-if="childState === 'declined'">
        {{ $t('dialogs.shareInvitationDialog.titleDeclined') }}
      </template>
      <template v-else>
        {{ $t('dialogs.shareInvitationDialog.titleNotFound') }}
      </template>
    </h2>

    <template v-if="childState === 'pending'">
      <div class="flex flex-col gap-3">
        <p class="text-muted-foreground text-center text-sm">
          <i18n-t keypath="dialogs.shareInvitationDialog.pendingMessage" tag="span">
            <template #resource>
              <strong class="text-foreground">
                {{ invitation.resourceName || $t('dialogs.shareInvitationDialog.unknownResource') }}
              </strong>
            </template>
          </i18n-t>
        </p>

        <ul class="flex flex-col gap-2">
          <li class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span class="text-muted-foreground">{{ $t('dialogs.shareInvitationDialog.permissionLabel') }}</span>
            <strong>{{ permissionLabel({ invitation, t }) }}</strong>
          </li>
          <li class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span class="text-muted-foreground">{{ $t('dialogs.shareInvitationDialog.expiresLabel') }}</span>
            <strong>{{ formatExpiry(invitation.expiresAt) }}</strong>
          </li>
        </ul>
      </div>

      <div class="flex shrink-0 flex-col-reverse pt-4 sm:flex-row sm:justify-end sm:gap-x-2">
        <DemoRestricted feature="share_invitation_decline">
          <Button
            variant="outline"
            class="flex-1"
            :loading="declineMutation.isPending.value"
            :disabled="isDemo || acceptMutation.isPending.value || declineMutation.isPending.value"
            @click="declineMutation.mutate()"
          >
            {{ $t('dialogs.shareInvitationDialog.decline') }}
          </Button>
        </DemoRestricted>
        <DemoRestricted feature="share_invitation_accept">
          <Button
            class="flex-1"
            :loading="acceptMutation.isPending.value"
            :disabled="isDemo || acceptMutation.isPending.value || declineMutation.isPending.value"
            @click="acceptMutation.mutate()"
          >
            {{ $t('dialogs.shareInvitationDialog.accept') }}
          </Button>
        </DemoRestricted>
      </div>
    </template>

    <template v-else-if="childState === 'accepted'">
      <div class="flex flex-col items-center gap-3 text-center">
        <CheckCircleIcon class="text-app-income-color size-6" />
        <p class="text-muted-foreground text-sm">{{ $t('dialogs.shareInvitationDialog.acceptedBody') }}</p>
      </div>

      <div class="flex shrink-0 pt-4 sm:justify-end">
        <Button class="w-full" @click="goToResource">
          {{ goToResourceLabel }}
        </Button>
      </div>
    </template>

    <template v-else-if="childState === 'declined'">
      <p class="text-muted-foreground text-center text-sm">
        {{ $t('dialogs.shareInvitationDialog.declinedBody') }}
      </p>

      <div class="flex shrink-0 pt-4 sm:justify-end">
        <Button variant="outline" class="w-full" @click="closeDialog">
          {{ $t('dialogs.shareInvitationDialog.close') }}
        </Button>
      </div>
    </template>

    <template v-else>
      <p class="text-destructive-text text-center text-sm">
        {{ $t('dialogs.shareInvitationDialog.unexpectedError') }}
      </p>

      <div class="flex shrink-0 pt-4 sm:justify-end">
        <Button variant="outline" class="w-full" @click="closeDialog">
          {{ $t('dialogs.shareInvitationDialog.close') }}
        </Button>
      </div>
    </template>
  </div>
</template>
