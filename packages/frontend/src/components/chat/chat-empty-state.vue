<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { ROUTES_NAMES } from '@/routes/constants';
import { SettingsIcon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

import { AiChatIcon } from './chat-icon';

defineProps<{
  /** Whether Chat has a model of the user's own to run on. */
  isConfigured: boolean;
}>();

const emit = defineEmits<{ prompt: [text: string] }>();

const { t } = useI18n();

const PROMPT_KEYS = ['spending', 'biggest', 'subscriptions', 'duplicates'] as const;
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-4 py-10 text-center" data-testid="chat-empty-state">
    <template v-if="isConfigured">
      <div class="bg-primary/10 flex size-12 items-center justify-center rounded-full">
        <AiChatIcon class="text-primary-text size-6" aria-hidden="true" />
      </div>
      <h2 class="font-medium">{{ $t('chat.empty.title') }}</h2>
      <p class="text-muted-foreground max-w-md text-sm">{{ $t('chat.empty.description') }}</p>

      <div class="mt-2 flex w-full max-w-md flex-col gap-2">
        <p class="text-muted-foreground text-xs font-medium">{{ $t('chat.empty.promptsTitle') }}</p>
        <Button
          v-for="key in PROMPT_KEYS"
          :key="key"
          type="button"
          variant="outline"
          class="h-auto justify-start py-2 text-left whitespace-normal"
          data-testid="example-prompt"
          @click="emit('prompt', t(`chat.empty.prompts.${key}`))"
        >
          {{ $t(`chat.empty.prompts.${key}`) }}
        </Button>
      </div>
    </template>

    <template v-else>
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <SettingsIcon class="text-muted-foreground size-6" aria-hidden="true" />
      </div>
      <h2 class="font-medium">{{ $t('chat.empty.notConfigured.title') }}</h2>
      <p class="text-muted-foreground max-w-md text-sm">{{ $t('chat.empty.notConfigured.description') }}</p>
      <RouterLink :to="{ name: ROUTES_NAMES.settingsAiModels }" class="mt-1">
        <Button as="span">{{ $t('chat.empty.notConfigured.cta') }}</Button>
      </RouterLink>
    </template>
  </div>
</template>
