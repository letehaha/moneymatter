<script setup lang="ts">
import { acceptShareInvitation, backInviteFromShareInvitation, declineShareInvitation } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useCategoriesStore, useUserStore } from '@/stores';
import {
  API_ERROR_CODES,
  type HouseholdSharePermission,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  type TransactionsWriteScope,
} from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { CheckCircleIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type InvitationLike, extractApiError, formatExpiry, permissionLabel as resolvePermissionLabel } from './utils';

/**
 * Household invitation body + footer. Owns the back-invite form, currency-mismatch
 * branch, and acceptance flow that's unique to household membership. Mirrors the
 * structure of `resource-share-invitation-content.vue` so the wrapper can pick
 * either by `resourceType` without knowing the internals.
 */

const props = defineProps<{
  invitation: InvitationLike;
}>();

const emit = defineEmits<{
  close: [];
  accepted: [];
  declined: [];
}>();

const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification, addWarningNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const categoriesStore = useCategoriesStore();
const { isDemo } = storeToRefs(useUserStore());

type ChildState = 'pending' | 'accepted' | 'back-invite-sent' | 'declined' | 'currency-mismatch' | 'error';
const childState = ref<ChildState>('pending');
const expectedCurrency = ref<string | null>(null);

interface BackInviteContext {
  sourceInvitationId: string;
  ownerUsername: string;
}
// Captured at accept time so the "share back" prompt survives the received-invitations
// cache invalidation that fires immediately after accept.
const backInviteContext = ref<BackInviteContext | null>(null);

interface PermissionOption {
  label: string;
  value: HouseholdSharePermission;
}
interface WriteScopeOption {
  label: string;
  value: TransactionsWriteScope;
}
const backInvitePermissionOptions = computed<PermissionOption[]>(() => [
  { label: t('dialogs.shareInvitationDialog.backInvite.permissions.read'), value: SHARE_PERMISSIONS.read },
  { label: t('dialogs.shareInvitationDialog.backInvite.permissions.write'), value: SHARE_PERMISSIONS.write },
]);
const backInviteWriteScopeOptions = computed<WriteScopeOption[]>(() => [
  { label: t('dialogs.shareInvitationDialog.backInvite.writeScope.all'), value: TRANSACTIONS_WRITE_SCOPES.all },
  { label: t('dialogs.shareInvitationDialog.backInvite.writeScope.own'), value: TRANSACTIONS_WRITE_SCOPES.own },
]);
// Defaults are looked up by value so reordering the option array later can't silently
// flip the default. Bang-asserts are safe — both values are in the list above.
const findPermissionOption = (value: HouseholdSharePermission) =>
  backInvitePermissionOptions.value.find((o) => o.value === value)!;
const findWriteScopeOption = (value: TransactionsWriteScope) =>
  backInviteWriteScopeOptions.value.find((o) => o.value === value)!;
const backInvitePermission = ref<PermissionOption>(findPermissionOption(SHARE_PERMISSIONS.write));
const backInviteWriteScope = ref<WriteScopeOption>(findWriteScopeOption(TRANSACTIONS_WRITE_SCOPES.all));
const showBackInviteWriteScope = computed(() => backInvitePermission.value.value !== SHARE_PERMISSIONS.read);

watch(backInvitePermissionOptions, () => {
  backInvitePermission.value = findPermissionOption(backInvitePermission.value.value);
});
watch(backInviteWriteScopeOptions, () => {
  backInviteWriteScope.value = findWriteScopeOption(backInviteWriteScope.value.value);
});

const permissionLabel = (permission: InvitationLike['permission']) => resolvePermissionLabel(permission, t);

const acceptMutation = useMutation({
  mutationFn: () => acceptShareInvitation(props.invitation.token),
  onSuccess: async (data) => {
    // Snapshot back-invite context before invalidation — the source invitation row may
    // disappear from the cache after refetch. Only surface the prompt when the backend
    // says reciprocity isn't already in place (avoids the A→B→A→B loop).
    if (data.canBackInvite) {
      backInviteContext.value = {
        sourceInvitationId: props.invitation.id,
        ownerUsername: props.invitation.owner?.username || t('dialogs.shareInvitationDialog.unknownOwner'),
      };
    }
    childState.value = 'accepted';
    addSuccessNotification(t('dialogs.shareInvitationDialog.acceptSuccess'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
    // Wrapped in try/catch — a refetch failure shouldn't reject the mutation after the
    // dialog has already transitioned to the accepted state.
    try {
      await Promise.all([accountsStore.refetchAccounts(), categoriesStore.loadCategories({ force: true })]);
    } catch (refreshErr) {
      addErrorNotification(t('dialogs.shareInvitationDialog.acceptDataRefreshFailed'));
      console.error(refreshErr);
    }
    emit('accepted');
  },
  onError: (err: unknown) => {
    const { code, message, details } = extractApiError(err);
    if (code === API_ERROR_CODES.shareCurrencyMismatch) {
      // Inline state — gives the recipient a clear "change base currency" CTA instead of
      // a transient toast. Other backend codes (terminal 409, expired, etc.) collapse to
      // the generic error state below.
      const expected = details?.expectedCurrency;
      expectedCurrency.value = typeof expected === 'string' ? expected : null;
      childState.value = 'currency-mismatch';
      return;
    }
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

const backInviteMutation = useMutation({
  mutationFn: () => {
    if (!backInviteContext.value) {
      // Button is gated by `v-if="backInviteContext"`, so this should never fire. Surfacing
      // the localized error toast if it does (apiMessage falls back to `backInvite.error`).
      throw new Error('Missing back-invite context');
    }
    return backInviteFromShareInvitation({
      sourceInvitationId: backInviteContext.value.sourceInvitationId,
      permission: backInvitePermission.value.value,
      policy: showBackInviteWriteScope.value ? { transactionsWriteScope: backInviteWriteScope.value.value } : null,
    });
  },
  onSuccess: (data) => {
    if (data.emailOutcome === 'failed') {
      addErrorNotification(t('dialogs.shareInvitationDialog.backInvite.deliveryFailed'));
    } else if (data.emailOutcome === 'skipped') {
      addWarningNotification(t('dialogs.shareInvitationDialog.backInvite.emailNotConfigured'));
    } else {
      addSuccessNotification(t('dialogs.shareInvitationDialog.backInvite.success'));
    }
    childState.value = 'back-invite-sent';
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
  },
  onError: (err: unknown) => {
    const { code, message } = extractApiError(err);
    // 409 covers both "already shares with this user" and "already sent a back-invite" —
    // in either case the recipient's intent ("share back") is already realized, so collapse
    // to the success view rather than leaving them on the form clicking again.
    if (code === API_ERROR_CODES.conflict) {
      childState.value = 'back-invite-sent';
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
      return;
    }
    addErrorNotification(message || t('dialogs.shareInvitationDialog.backInvite.error'));
  },
});

const closeDialog = () => emit('close');
const goToCurrencySettings = () => {
  router.push({ name: ROUTES_NAMES.settingsCurrencies });
};
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
      <template v-else-if="childState === 'back-invite-sent'">
        {{ $t('dialogs.shareInvitationDialog.backInvite.sentTitle') }}
      </template>
      <template v-else-if="childState === 'declined'">
        {{ $t('dialogs.shareInvitationDialog.titleDeclined') }}
      </template>
      <template v-else-if="childState === 'currency-mismatch'">
        {{ $t('dialogs.shareInvitationDialog.titleCurrencyMismatch') }}
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
                {{ $t('dialogs.shareInvitationDialog.householdResourceLabel') }}
              </strong>
            </template>
          </i18n-t>
        </p>

        <ul class="flex flex-col gap-2">
          <li class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span class="text-muted-foreground">{{ $t('dialogs.shareInvitationDialog.permissionLabel') }}</span>
            <strong>{{ permissionLabel(invitation.permission) }}</strong>
          </li>
          <li class="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span class="text-muted-foreground">{{ $t('dialogs.shareInvitationDialog.expiresLabel') }}</span>
            <strong>{{ formatExpiry(invitation.expiresAt) }}</strong>
          </li>
        </ul>
      </div>

      <div class="flex shrink-0 flex-col-reverse pt-4 sm:flex-row sm:justify-end sm:gap-x-2">
        <DemoRestricted feature="household_invitation_decline">
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
        <DemoRestricted feature="household_invitation_accept">
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
      <div class="flex flex-col gap-4">
        <div class="flex flex-col items-center gap-3 text-center">
          <CheckCircleIcon class="text-app-income-color size-6" />
          <p class="text-muted-foreground text-sm">{{ $t('dialogs.shareInvitationDialog.acceptedBody') }}</p>
        </div>

        <div v-if="backInviteContext" class="bg-muted/40 flex flex-col gap-3 rounded-md border p-4">
          <p class="text-sm">
            <i18n-t keypath="dialogs.shareInvitationDialog.backInvite.prompt" tag="span">
              <template #owner>
                <strong class="text-foreground">@{{ backInviteContext.ownerUsername }}</strong>
              </template>
            </i18n-t>
          </p>
          <SelectField
            v-model="backInvitePermission"
            :values="backInvitePermissionOptions"
            :label="$t('dialogs.shareInvitationDialog.backInvite.permissionLabel')"
            label-key="label"
            value-key="value"
          />
          <SelectField
            v-if="showBackInviteWriteScope"
            v-model="backInviteWriteScope"
            :values="backInviteWriteScopeOptions"
            :label="$t('dialogs.shareInvitationDialog.backInvite.writeScopeLabel')"
            label-key="label"
            value-key="value"
          />
        </div>
      </div>

      <div class="flex shrink-0 flex-col-reverse pt-4 sm:flex-row sm:justify-end sm:gap-x-2">
        <template v-if="backInviteContext">
          <Button variant="outline" class="flex-1" :disabled="backInviteMutation.isPending.value" @click="closeDialog">
            {{ $t('dialogs.shareInvitationDialog.backInvite.notNow') }}
          </Button>
          <DemoRestricted feature="household_invitation_back_invite">
            <Button
              class="flex-1"
              :loading="backInviteMutation.isPending.value"
              :disabled="isDemo || backInviteMutation.isPending.value"
              @click="backInviteMutation.mutate()"
            >
              {{ $t('dialogs.shareInvitationDialog.backInvite.send') }}
            </Button>
          </DemoRestricted>
        </template>
        <Button v-else class="w-full" @click="closeDialog">
          {{ $t('dialogs.shareInvitationDialog.close') }}
        </Button>
      </div>
    </template>

    <template v-else-if="childState === 'back-invite-sent'">
      <div class="flex flex-col items-center gap-3 text-center">
        <CheckCircleIcon class="text-app-income-color size-6" />
        <p class="text-muted-foreground text-sm">
          <i18n-t keypath="dialogs.shareInvitationDialog.backInvite.sentBody" tag="span">
            <template #owner>
              <strong class="text-foreground">@{{ backInviteContext?.ownerUsername ?? '' }}</strong>
            </template>
          </i18n-t>
        </p>
      </div>

      <div class="flex shrink-0 pt-4 sm:justify-end">
        <Button class="w-full" @click="closeDialog">
          {{ $t('dialogs.shareInvitationDialog.backInvite.done') }}
        </Button>
      </div>
    </template>

    <template v-else-if="childState === 'currency-mismatch'">
      <p class="text-muted-foreground text-center text-sm">
        <template v-if="expectedCurrency">
          {{ $t('dialogs.shareInvitationDialog.currencyMismatch', { currency: expectedCurrency }) }}
        </template>
        <template v-else>
          {{ $t('dialogs.shareInvitationDialog.currencyMismatchUnknown') }}
        </template>
      </p>

      <div class="flex shrink-0 flex-col-reverse pt-4 sm:flex-row sm:justify-end sm:gap-x-2">
        <Button variant="outline" class="flex-1" @click="closeDialog">
          {{ $t('dialogs.shareInvitationDialog.close') }}
        </Button>
        <Button class="flex-1" @click="goToCurrencySettings">
          {{ $t('dialogs.shareInvitationDialog.updateBaseCurrency') }}
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
