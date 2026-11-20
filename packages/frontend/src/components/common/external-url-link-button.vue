<script setup lang="ts">
import { safeExternalUrl } from '@/common/utils/external-url';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ExternalLinkIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{ url: string | null | undefined; label: string }>();

const href = computed(() => safeExternalUrl({ value: props.url }));
</script>

<template>
  <DesktopOnlyTooltip v-if="href" :content="label">
    <UiButton variant="ghost" size="icon-sm" as-child class="shrink-0">
      <a :href="href" target="_blank" rel="noopener noreferrer" :aria-label="label">
        <ExternalLinkIcon class="size-4" />
      </a>
    </UiButton>
  </DesktopOnlyTooltip>
</template>
