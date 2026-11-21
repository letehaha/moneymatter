<template>
  <Card class="max-w-4xl">
    <CardHeader class="border-b">
      <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.admin.title') }}</h2>
      <p class="text-sm opacity-80">{{ $t('settings.admin.description') }}</p>
    </CardHeader>

    <CardContent class="mt-4">
      <Tabs :model-value="activeTab" @update:model-value="onTabChange">
        <TabsList variant="underline">
          <TabsTrigger :value="TAB.investments">{{ $t('settings.admin.tabs.investments') }}</TabsTrigger>
          <TabsTrigger :value="TAB.notifications">{{ $t('settings.admin.tabs.notifications') }}</TabsTrigger>
        </TabsList>

        <TabsContent :value="TAB.investments" class="mt-6 flex flex-col gap-6">
          <div>
            <h3 class="mb-2 text-lg font-medium">{{ $t('settings.admin.priceSync.title') }}</h3>
            <p class="mb-4 text-sm leading-relaxed">
              {{ $t('settings.admin.priceSync.description') }}
            </p>

            <Button :disabled="isPriceSyncLoading" @click="triggerPriceSync">
              <span
                v-if="isPriceSyncLoading"
                class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              {{
                isPriceSyncLoading
                  ? $t('settings.admin.priceSync.buttonLoading')
                  : $t('settings.admin.priceSync.button')
              }}
            </Button>
          </div>

          <div>
            <h3 class="mb-2 text-lg font-medium">{{ $t('settings.admin.priceUpload.title') }}</h3>
            <p class="mb-4 text-sm leading-relaxed">{{ $t('settings.admin.priceUpload.description') }}</p>

            <SecurityPriceUpload>
              <Button>{{ $t('settings.admin.priceUpload.button') }}</Button>
            </SecurityPriceUpload>
          </div>
        </TabsContent>

        <TabsContent :value="TAB.notifications" class="mt-6">
          <BroadcastNotificationForm />
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { triggerSecuritiesPriceSync } from '@/api/investments';
import Button from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useUserStore } from '@/stores';
import { API_ERROR_CODES } from '@bt/shared/types';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BroadcastNotificationForm from './broadcast-notification-form.vue';
import SecurityPriceUpload from './security-price-upload.vue';

const TAB = { investments: 'investments', notifications: 'notifications' } as const;
type Tab = (typeof TAB)[keyof typeof TAB];
const TAB_VALUES = Object.values(TAB) as string[];

const userStore = useUserStore();
const route = useRoute();
const router = useRouter();

const activeTab = computed<Tab>(() =>
  TAB_VALUES.includes(String(route.query.tab)) ? (route.query.tab as Tab) : TAB.investments,
);
const onTabChange = (value: string | number) => {
  router.replace({ query: { ...route.query, tab: String(value) } });
};
const { addNotification } = useNotificationCenter();
const { t } = useI18n();

const isPriceSyncLoading = ref(false);
const showAccessDenied = ref(false);

const triggerPriceSync = async () => {
  isPriceSyncLoading.value = true;

  try {
    await triggerSecuritiesPriceSync();

    addNotification({
      id: 'price-sync-success',
      text: t('settings.admin.priceSync.notifications.success'),
      type: NotificationType.success,
    });
  } catch (error) {
    const errorData = (error as any)?.data;
    const errorMessage = (error as any)?.message || 'Failed to trigger price sync';

    if (errorData?.code === API_ERROR_CODES.tooManyRequests) {
      const retryAfter = errorData?.details?.retryAfter || 300; // Default 5 minutes
      const minutes = Math.ceil(retryAfter / 60);
      const time = retryAfter < 60 ? `${retryAfter} seconds` : `${minutes} minutes`;

      addNotification({
        id: 'price-sync-rate-limited',
        text: t('settings.admin.priceSync.notifications.rateLimited', { time }),
        type: NotificationType.warning,
      });
    }
    // Check if it's an admin access error
    else if (errorData?.code === 'unauthorized' || errorMessage.includes('Admin')) {
      showAccessDenied.value = true;
      addNotification({
        id: 'admin-access-denied',
        text: t('settings.admin.priceSync.notifications.adminRequired'),
        type: NotificationType.error,
      });
    } else {
      addNotification({
        id: 'price-sync-error',
        text: t('settings.admin.priceSync.notifications.failed'),
        type: NotificationType.error,
      });
    }
  } finally {
    isPriceSyncLoading.value = false;
  }
};

// Check admin access on mount
onMounted(() => {
  if (!userStore.user) {
    router.push('/sign-in');
  }
});
</script>
