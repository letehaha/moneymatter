<script setup lang="ts">
import { wipeUserData } from '@/api/user';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { resetQueryCaches } from '@/lib/query-persister';
import { captureException } from '@/lib/sentry';
import { API_ERROR_CODES, type WipeDataSharedResources } from '@bt/shared/types';
import { Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();

const WIPE_CONFIRMATION = 'WIPE MY DATA';

const isPrimaryOpen = ref(false);
const isSharingOpen = ref(false);
const confirmText = ref('');
const sharedResources = ref<WipeDataSharedResources | null>(null);

// Delay before the post-wipe reload – gives the success toast time to render before the
// page navigation tears it down. Without this, the user sees the dialog close and a hard
// reload with no visible confirmation that the wipe actually happened.
const POST_WIPE_RELOAD_DELAY_MS = 1200;

const { isPending: isWiping, mutate: wipe } = useMutation({
  mutationFn: ({ acknowledgeSharing }: { acknowledgeSharing: boolean }) => wipeUserData({ acknowledgeSharing }),
  onSuccess: async () => {
    addSuccessNotification(t('settings.security.wipeData.notifications.success'));
    // The reload below rehydrates whitelisted queries from the persisted IndexedDB
    // store, so without purging it first the post-wipe app would restore pre-wipe
    // currencies/accounts/etc. that no longer exist server-side. Same teardown
    // logout performs.
    await resetQueryCaches(queryClient);
    // Fresh start — reload so onboarding picks up the empty state and the user re-picks
    // a base currency without any stale cached data lingering in stores or query cache.
    setTimeout(() => window.location.reload(), POST_WIPE_RELOAD_DELAY_MS);
  },
  onError: (e, { acknowledgeSharing }) => {
    if (e instanceof ApiErrorResponseError && e.data?.code === API_ERROR_CODES.wipeDataSharingAcknowledgementRequired) {
      sharedResources.value =
        (e.data.details as { sharedResources?: WipeDataSharedResources } | undefined)?.sharedResources ?? null;
      isPrimaryOpen.value = false;
      isSharingOpen.value = true;
      return;
    }
    // Non-409 errors are unexpected – surface the server-provided message when available
    // so the user gets actionable copy instead of a generic "try again", and capture for
    // observability since a destructive flow failure may leave partial state.
    const serverMessage = e instanceof ApiErrorResponseError ? e.data?.message : null;
    addErrorNotification(serverMessage || t('settings.security.wipeData.notifications.failed'));
    captureException({ error: e, context: { feature: 'wipe-user-data', acknowledgeSharing } });
  },
});

const canConfirm = computed(() => confirmText.value === WIPE_CONFIRMATION && !isWiping.value);

const resetState = () => {
  confirmText.value = '';
  sharedResources.value = null;
};

const handlePrimaryConfirm = () => {
  if (!canConfirm.value) return;
  wipe({ acknowledgeSharing: false });
};

const handleSharingConfirm = () => {
  isSharingOpen.value = false;
  wipe({ acknowledgeSharing: true });
};

const handlePrimaryOpenChange = (open: boolean) => {
  isPrimaryOpen.value = open;
  if (!open) resetState();
};
</script>

<template>
  <div class="flex flex-col justify-between gap-4 @md/danger-zone:flex-row @md/danger-zone:items-center">
    <div>
      <p class="mb-2 font-bold">{{ $t('settings.security.wipeData.title') }}</p>
      <i18n-t keypath="settings.security.wipeData.warningFull" tag="p" class="text-sm">
        <template #strong>
          <b>{{ $t('settings.security.wipeData.warningStrong') }}</b>
        </template>
      </i18n-t>
    </div>

    <Button variant="destructive" class="shrink-0" @click="isPrimaryOpen = true">
      <Trash2Icon class="size-4" />
      {{ $t('settings.security.wipeData.button') }}
    </Button>

    <ResponsiveAlertDialog
      :open="isPrimaryOpen"
      :confirm-disabled="!canConfirm"
      confirm-variant="destructive"
      :confirm-label="
        isWiping
          ? $t('settings.security.wipeData.dialog.confirmLoading')
          : $t('settings.security.wipeData.dialog.confirmLabel')
      "
      @update:open="handlePrimaryOpenChange"
      @confirm="handlePrimaryConfirm"
    >
      <template #title>{{ $t('settings.security.wipeData.dialog.title') }}</template>
      <template #description>
        <div class="text-left">
          {{ $t('settings.security.wipeData.dialog.description') }}
          <ul class="mt-2 list-inside list-disc text-sm">
            <li>{{ $t('settings.security.wipeData.dialog.list.accounts') }}</li>
            <li>{{ $t('settings.security.wipeData.dialog.list.transactions') }}</li>
            <li>{{ $t('settings.security.wipeData.dialog.list.budgets') }}</li>
            <li>{{ $t('settings.security.wipeData.dialog.list.portfolios') }}</li>
            <li>{{ $t('settings.security.wipeData.dialog.list.settings') }}</li>
            <li>{{ $t('settings.security.wipeData.dialog.list.baseCurrency') }}</li>
          </ul>
          <p class="mt-3 text-sm">{{ $t('settings.security.wipeData.dialog.kept') }}</p>
        </div>
      </template>

      <i18n-t keypath="settings.security.wipeData.dialog.typeConfirm" tag="div" class="mt-4 mb-2 text-left text-sm">
        <template #phrase>
          <b>{{ WIPE_CONFIRMATION }}</b>
        </template>
      </i18n-t>
      <InputField
        v-model="confirmText"
        :placeholder="WIPE_CONFIRMATION"
        class="border-destructive focus-visible:outline-destructive"
      />
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isSharingOpen"
      confirm-variant="destructive"
      :confirm-label="$t('settings.security.wipeData.sharingDialog.confirmLabel')"
      @confirm="handleSharingConfirm"
    >
      <template #title>{{ $t('settings.security.wipeData.sharingDialog.title') }}</template>
      <template #description>
        <div class="text-left">
          <div class="text-destructive-text mb-3 flex items-center gap-2">
            <TriangleAlertIcon class="size-4" />
            <span class="font-medium">{{ $t('settings.security.wipeData.sharingDialog.warning') }}</span>
          </div>
          <p class="mb-3 text-sm">{{ $t('settings.security.wipeData.sharingDialog.description') }}</p>
          <ul v-if="sharedResources?.accounts?.length" class="mb-2 list-inside list-disc text-sm">
            <li v-for="account in sharedResources.accounts" :key="account.id">{{ account.name }}</li>
          </ul>
          <p v-if="sharedResources?.households?.length" class="text-sm">
            {{
              $t('settings.security.wipeData.sharingDialog.householdsCount', {
                count: sharedResources.households.length,
              })
            }}
          </p>
        </div>
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
