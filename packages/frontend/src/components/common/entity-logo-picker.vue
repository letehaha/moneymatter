<script setup lang="ts">
import { type LogoSelection, type LogoTab, toLogoPayload, toLogoSelection } from '@/components/common/logo-selection';
import LogoSearch from '@/components/common/logo-search.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage, isApiErrorWithCode, isNotFoundError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { API_ERROR_CODES, type EntityLogoWritePayload } from '@bt/shared/types';
import { RotateCcwIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

const props = defineProps<{
  open: boolean;
  nameForSearch: string;
  currentDomain: string | null;
  currentInitials?: string | null;
  currentColor?: string | null;
  title: string;
  description: string;
  resetLabel: string;
  savedMessage: string;
  resetMessage: string;
  errorMessage: string;
  /** Names the owning feature in Sentry reports. */
  flow: string;
  save: (params: { payload: EntityLogoWritePayload }) => Promise<unknown>;
  reset: () => Promise<unknown>;
  tabs?: LogoTab[];
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const isSaving = ref(false);
const isResetting = ref(false);
const isSubmitting = computed(() => isSaving.value || isResetting.value);

const currentSelection = computed(() =>
  toLogoSelection({
    logoDomain: props.currentDomain,
    logoInitials: props.currentInitials,
    logoColor: props.currentColor,
  }),
);

function handleMutationError({ error, operation }: { error: unknown; operation: 'save' | 'reset' }) {
  // The API client logs the user out and announces the expired session itself.
  if (isApiErrorWithCode(error, API_ERROR_CODES.unauthorized)) return;
  // A rejected logo payload names the rule that was broken (mutual exclusion,
  // initials length, color format), so the server message is the advice to show.
  if (isApiErrorWithCode(error, API_ERROR_CODES.validationError)) {
    addErrorNotification(extractApiErrorMessage(error) || props.errorMessage);
    return;
  }
  // The entity was deleted or merged elsewhere after this dialog opened.
  if (isNotFoundError(error)) {
    addErrorNotification(extractApiErrorMessage(error) || props.errorMessage);
    return;
  }
  captureException({ error, context: { flow: props.flow, operation } });
  addErrorNotification(props.errorMessage);
}

async function handleSelect(selection: LogoSelection) {
  isSaving.value = true;
  try {
    await props.save({ payload: toLogoPayload({ selection }) });
    addSuccessNotification(props.savedMessage);
    isOpen.value = false;
  } catch (error) {
    handleMutationError({ error, operation: 'save' });
  } finally {
    isSaving.value = false;
  }
}

async function handleReset() {
  isResetting.value = true;
  try {
    await props.reset();
    addSuccessNotification(props.resetMessage);
    isOpen.value = false;
  } catch (error) {
    handleMutationError({ error, operation: 'reset' });
  } finally {
    isResetting.value = false;
  }
}
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>
      <span class="text-lg font-semibold">{{ title }}</span>
    </template>
    <template #description>{{ description }}</template>

    <template #default>
      <div class="flex flex-col gap-4 p-4">
        <div class="border-input overflow-hidden rounded-md border">
          <LogoSearch
            :selection="currentSelection"
            :name-for-search="nameForSearch"
            :tabs="tabs"
            @select="handleSelect"
          />
        </div>

        <div class="flex items-center justify-between gap-2 border-t pt-2">
          <Button variant="ghost" size="sm" :disabled="isSubmitting" :loading="isResetting" @click="handleReset">
            <RotateCcwIcon class="size-4" />
            {{ resetLabel }}
          </Button>
          <Button variant="ghost" :disabled="isSubmitting" @click="isOpen = false">
            {{ $t('common.actions.cancel') }}
          </Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
