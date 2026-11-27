<script setup lang="ts">
import PageWrapper from '@/components/common/page-wrapper.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { Loader2Icon } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { usePlaidLink } from './use-plaid-link';

const route = useRoute();
const router = useRouter();
const { run } = usePlaidLink();
const status = ref<'resuming' | 'unavailable' | 'failed'>('resuming');

onMounted(async () => {
  if (typeof route.query.oauth_state_id !== 'string' || !route.query.oauth_state_id) {
    status.value = 'unavailable';
    return;
  }

  const result = await run({ receivedRedirectUri: window.location.href });
  if (!result) return;

  if (result.status === 'connected') {
    await router.replace({
      name: ROUTES_NAMES.accountIntegrationDetails,
      params: { connectionId: result.connectionId },
      query: { connect: 'accounts' },
    });
  } else if (result.status === 'cancelled') {
    await router.replace({ name: ROUTES_NAMES.accounts });
  } else {
    status.value = result.status;
    await router.replace({ name: ROUTES_NAMES.plaidCallback });
  }
});
</script>

<template>
  <PageWrapper class="mx-auto max-w-lg">
    <div v-if="status === 'resuming'" class="flex items-center gap-3 py-8" role="status">
      <Loader2Icon class="size-5 motion-safe:animate-spin" aria-hidden="true" />
      <h1 class="text-lg font-semibold">{{ $t('pages.integrations.plaid.resuming') }}</h1>
    </div>
    <div v-else class="space-y-4 py-8">
      <div class="space-y-1" role="alert">
        <h1 class="text-lg font-semibold">{{ $t('pages.bankCallback.error.title') }}</h1>
        <p class="text-muted-foreground text-sm">
          {{
            status === 'unavailable'
              ? $t('pages.integrations.plaid.resumeUnavailable')
              : $t('pages.integrations.plaid.flowFailed')
          }}
        </p>
      </div>
      <UiButton as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.accounts }">{{ $t('pages.bankCallback.error.backToIntegrations') }}</RouterLink>
      </UiButton>
    </div>
  </PageWrapper>
</template>
