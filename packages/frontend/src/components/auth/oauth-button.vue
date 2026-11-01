<template>
  <Button type="button" variant="outline" class="relative w-full gap-2" :disabled="isLoading" @click="handleClick">
    <slot name="icon" />
    <span>{{ buttonText }}</span>
    <LastUsedBadge v-if="isLastUsed" class="absolute -top-2.25 right-2.5" />
  </Button>
</template>

<script lang="ts" setup>
import LastUsedBadge from '@/components/auth/last-used-badge.vue';
import { getOAuthProviderName } from '@/components/auth/oauth-providers';
import { Button } from '@/components/lib/ui/button';
import { OAUTH_PROVIDER } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface Props {
  provider: OAUTH_PROVIDER;
  /** Server-configured OIDC provider name. */
  providerName?: string;
  mode?: 'signin' | 'signup';
  isLoading?: boolean;
  isLastUsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'signin',
  isLoading: false,
});

const emit = defineEmits<{
  click: [provider: OAUTH_PROVIDER];
}>();

const { t } = useI18n();

const buttonText = computed(() => {
  const providerName = getOAuthProviderName({ provider: props.provider, oidcName: props.providerName });
  return props.mode === 'signup'
    ? t('auth.shared.oauthButton.signUp', { provider: providerName })
    : t('auth.shared.oauthButton.signIn', { provider: providerName });
});

const handleClick = () => {
  emit('click', props.provider);
};
</script>
