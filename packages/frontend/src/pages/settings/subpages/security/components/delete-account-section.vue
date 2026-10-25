<script setup lang="ts">
import { deleteUserAccount } from '@/api/user';
import ClickToCopy from '@/components/common/click-to-copy.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { ROUTES_NAMES } from '@/routes';
import { useAuthStore, useUserStore } from '@/stores';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { BILLING_PROVIDERS, isEntitledSubscription } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const router = useRouter();
const authStore = useAuthStore();
const { user, entitlements } = storeToRefs(useUserStore());
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

const isDialogOpen = ref(false);
const confirmEmail = ref('');
const isDeleting = ref(false);

const hasEntitledAppStoreSubscription = computed(() =>
  Boolean(
    entitlements.value?.subscriptions.some(
      (sub) => sub.provider === BILLING_PROVIDERS.apple && isEntitledSubscription(sub),
    ),
  ),
);

const isDeleteDisabled = computed(() => confirmEmail.value !== user.value?.email || isDeleting.value);

const handleDeleteAccount = async () => {
  if (confirmEmail.value !== user.value?.email) return;

  isDeleting.value = true;
  try {
    await deleteUserAccount();
    addSuccessNotification(t('settings.security.deleteAccount.notifications.success'));
    authStore.logout();
    router.push({ name: ROUTES_NAMES.signIn });
  } catch {
    addErrorNotification(t('settings.security.deleteAccount.notifications.failed'));
  } finally {
    isDeleting.value = false;
  }
};

const handleOpenChange = (open: boolean) => {
  isDialogOpen.value = open;
  if (!open) confirmEmail.value = '';
};
</script>

<template>
  <div class="flex flex-col justify-between gap-4 @md/danger-zone:flex-row @md/danger-zone:items-center">
    <div>
      <p class="mb-2 font-bold">{{ $t('settings.security.deleteAccount.title') }}</p>
      <i18n-t keypath="settings.security.deleteAccount.warningFull" tag="p" class="text-sm">
        <template #strong>
          <b>{{ $t('settings.security.deleteAccount.warningStrong') }}</b>
        </template>
      </i18n-t>
    </div>

    <Button variant="destructive" class="shrink-0" @click="isDialogOpen = true">
      {{ $t('settings.security.deleteAccount.button') }}
    </Button>

    <ResponsiveAlertDialog
      :open="isDialogOpen"
      :confirm-disabled="isDeleteDisabled"
      confirm-variant="destructive"
      :confirm-label="
        isDeleting
          ? $t('settings.security.deleteAccount.dialog.acceptButtonLoading')
          : $t('settings.security.deleteAccount.dialog.acceptButton')
      "
      @update:open="handleOpenChange"
      @confirm="handleDeleteAccount"
    >
      <template #title>{{ $t('settings.security.deleteAccount.dialog.title') }}</template>
      <template #description>
        <div class="text-left">
          {{ $t('settings.security.deleteAccount.dialog.description') }}
          <ul class="mt-2 list-disc pl-5 text-sm">
            <li>{{ $t('settings.security.deleteAccount.dialog.dataList.accounts') }}</li>
            <li>{{ $t('settings.security.deleteAccount.dialog.dataList.categories') }}</li>
            <li>{{ $t('settings.security.deleteAccount.dialog.dataList.portfolios') }}</li>
            <li>{{ $t('settings.security.deleteAccount.dialog.dataList.settings') }}</li>
          </ul>
        </div>
      </template>

      <Callout v-if="hasEntitledAppStoreSubscription" class="mt-4 text-left">
        <i18n-t keypath="settings.security.deleteAccount.dialog.appStoreWarning" tag="p">
          <template #link>
            <a
              :href="EXTERNAL_URLS.appStoreSubscriptions"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline underline-offset-2 hover:no-underline"
            >
              {{ $t('settings.security.deleteAccount.dialog.appStoreWarningLink') }}
            </a>
          </template>
        </i18n-t>
      </Callout>

      <i18n-t
        keypath="settings.security.deleteAccount.dialog.confirmFull"
        tag="div"
        class="mt-4 mb-2 text-left text-sm"
      >
        <template #email>
          <ClickToCopy :value="user?.email ?? ''" />
        </template>
      </i18n-t>
      <InputField
        v-model="confirmEmail"
        :placeholder="$t('settings.security.deleteAccount.dialog.placeholder')"
        class="border-destructive focus-visible:outline-destructive"
      />
    </ResponsiveAlertDialog>
  </div>
</template>
