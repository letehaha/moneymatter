<template>
  <Button type="button" variant="outline" class="relative w-full gap-2" :disabled="isLoading" @click="handleClick">
    <slot name="icon">
      <component :is="providerIcon" v-if="providerIcon" class="size-5" />
    </slot>
    <span>{{ buttonText }}</span>
    <LastUsedBadge v-if="isLastUsed" class="absolute -top-2.25 right-2.5" />
  </Button>
</template>

<script lang="ts" setup>
import LastUsedBadge from '@/components/auth/last-used-badge.vue';
import { Button } from '@/components/lib/ui/button';
import { OAUTH_PROVIDER } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface Props {
  provider: OAUTH_PROVIDER;
  /** Overrides the built-in name, e.g. the server-configured OIDC provider name. */
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

const providerConfig: Record<OAUTH_PROVIDER, { name: string; icon: null }> = {
  [OAUTH_PROVIDER.google]: { name: 'Google', icon: null },
  [OAUTH_PROVIDER.github]: { name: 'GitHub', icon: null },
  [OAUTH_PROVIDER.oidc]: { name: 'SSO', icon: null },
};

const providerIcon = computed(() => providerConfig[props.provider]?.icon);

const buttonText = computed(() => {
  const providerName = props.providerName || providerConfig[props.provider]?.name || props.provider;
  return props.mode === 'signup'
    ? t('auth.shared.oauthButton.signUp', { provider: providerName })
    : t('auth.shared.oauthButton.signIn', { provider: providerName });
});

const handleClick = () => {
  emit('click', props.provider);
};
</script>
