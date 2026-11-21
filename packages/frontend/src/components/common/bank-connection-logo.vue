<script setup lang="ts">
import { type BankConnection, listConnections } from '@/api/bank-data-providers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { getServiceLogoUrl } from '@/common/utils/logo-url';
import { useIdleEnabled } from '@/composable/use-idle-enabled';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';

import BankProviderLogo from './bank-providers/bank-provider-logo.vue';

/** Tailwind sizing utilities this logo is laid out against. */
export type BankConnectionLogoSize = 'size-4' | 'size-5' | 'size-7';

const props = withDefaults(
  defineProps<{
    connectionId: string | null | undefined;
    /** Falls back to the institution's own name when omitted. */
    alt?: string;
    size?: BankConnectionLogoSize;
  }>(),
  { alt: undefined, size: 'size-4' },
);

// Bank logos are non-critical decoration, so defer the connections lookup until the
// browser is idle to keep it off the dashboard's critical path.
const idleEnabled = useIdleEnabled();
const { data: bankConnections } = useQuery({
  queryFn: listConnections,
  queryKey: VUE_QUERY_CACHE_KEYS.bankConnections,
  staleTime: Infinity,
  enabled: idleEnabled,
  placeholderData: [] as BankConnection[],
});

const connection = computed(() => {
  if (!props.connectionId) return null;
  return bankConnections.value?.find((c) => c.id === props.connectionId) ?? null;
});

const institutionLogoUrl = computed(() => {
  if (!connection.value?.bankLogoDomain) return null;
  return getServiceLogoUrl({ domain: connection.value.bankLogoDomain });
});

const logoError = ref(false);

watch(institutionLogoUrl, () => {
  logoError.value = false;
});
</script>

<template>
  <img
    v-if="institutionLogoUrl && !logoError"
    :src="institutionLogoUrl"
    :alt="alt ?? connection?.bankName ?? ''"
    :class="['shrink-0', size]"
    @error="logoError = true"
  />
  <BankProviderLogo v-else-if="connection" :class="['shrink-0', size]" :provider="connection.providerType" />
  <slot v-else name="fallback" />
</template>
