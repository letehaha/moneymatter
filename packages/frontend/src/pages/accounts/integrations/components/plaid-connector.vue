<template>
  <div class="@container/plaid space-y-4">
    <p class="text-muted-foreground text-sm">{{ $t('pages.integrations.plaid.connectDescription') }}</p>
    <Callout v-if="error !== null" variant="destructive" role="alert">
      {{ error || $t('pages.integrations.plaid.flowFailed') }}
    </Callout>
    <div class="flex flex-col-reverse gap-2 @xs/plaid:flex-row @xs/plaid:justify-between">
      <UiButton variant="outline" :disabled="phase === 'finishing'" @click="$emit('cancel')">
        {{ $t('common.actions.back') }}
      </UiButton>
      <UiButton :disabled="phase !== null" :aria-busy="phase !== null" @click="$emit('connect')">
        <Loader2Icon v-if="phase" class="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {{ $t('pages.integrations.plaid.continueButton') }}
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { Loader2Icon } from '@lucide/vue';

import type { PlaidLinkPhase } from '../use-plaid-link';

defineProps<{ phase: PlaidLinkPhase; error: string | null }>();
defineEmits<{ connect: []; cancel: [] }>();
</script>
