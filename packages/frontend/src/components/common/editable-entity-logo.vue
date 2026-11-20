<script setup lang="ts">
import EntityLogoPicker from '@/components/common/entity-logo-picker.vue';
import { toLogoPayload } from '@/components/common/logo-selection';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { EntityLogoPayload, EntityLogoWritePayload } from '@bt/shared/types';
import { PencilIcon } from '@lucide/vue';
import { ref } from 'vue';

const props = defineProps<{
  entity: { name: string } & EntityLogoPayload;
  /** Names the owning feature in Sentry reports. */
  flow: string;
  save: (params: { payload: EntityLogoWritePayload }) => Promise<unknown>;
}>();

const isOpen = ref(false);

const reset = () => props.save({ payload: toLogoPayload({ selection: null }) });
</script>

<template>
  <div class="group relative shrink-0">
    <slot />
    <DesktopOnlyTooltip :content="$t('common.logo.editAriaLabel')">
      <Button
        variant="ghost"
        size="icon"
        class="bg-background/80 hover:bg-background absolute inset-0 size-full rounded-lg opacity-0 backdrop-blur-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        :aria-label="$t('common.logo.editAriaLabel')"
        @click="isOpen = true"
      >
        <PencilIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>

    <EntityLogoPicker
      v-model:open="isOpen"
      :name-for-search="entity.name"
      :current-domain="entity.logoDomain ?? null"
      :current-initials="entity.logoInitials ?? null"
      :current-color="entity.logoColor ?? null"
      :title="$t('common.logo.dialogTitle')"
      :description="$t('common.logo.pickerDescription')"
      :reset-label="$t('common.logo.remove')"
      :saved-message="$t('common.logo.updatedToast')"
      :reset-message="$t('common.logo.resetToast')"
      :error-message="$t('common.logo.updateError')"
      :flow="flow"
      :save="save"
      :reset="reset"
    />
  </div>
</template>
