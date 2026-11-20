<script setup lang="ts">
import { normalizeExternalUrl, validateOptionalExternalUrl } from '@/common/utils/external-url';
import ExternalUrlField from '@/components/fields/external-url-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useAccountsStore } from '@/stores';
import { AccountModel } from '@bt/shared/types';
import { PencilIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
}>();

const { t } = useI18n();
const accountsStore = useAccountsStore();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isOpen = ref(false);
const isSaving = ref(false);
const showError = ref(false);
const externalUrlInput = ref(props.account.externalUrl ?? '');

const normalizedNext = computed(() => normalizeExternalUrl({ value: externalUrlInput.value }));
const currentNormalized = computed(() => normalizeExternalUrl({ value: props.account.externalUrl }));
const isValid = computed(() => validateOptionalExternalUrl({ value: externalUrlInput.value }) === null);
const isSaveDisabled = computed(
  () => !isValid.value || normalizedNext.value === currentNormalized.value || isSaving.value,
);

const updateExternalUrl = async () => {
  showError.value = true;
  if (isSaveDisabled.value) return;

  isSaving.value = true;
  try {
    await accountsStore.editAccount({
      id: props.account.id,
      externalUrl: normalizedNext.value,
    });
    isOpen.value = false;
    addSuccessNotification(t('pages.account.details.externalUrlUpdateSuccess'));
  } catch {
    addErrorNotification(t('pages.account.details.externalUrlUpdateError'));
  } finally {
    isSaving.value = false;
  }
};

watch([isOpen, () => props.account.id], () => {
  externalUrlInput.value = props.account.externalUrl ?? '';
  showError.value = false;
});
</script>

<template>
  <DesktopOnlyTooltip :content="$t('pages.account.details.editExternalUrl')" :disabled="isOpen">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm" :aria-label="$t('pages.account.details.editExternalUrl')">
          <PencilIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent class="w-80">
        <form class="grid gap-4" @submit.prevent="updateExternalUrl">
          <ExternalUrlField
            v-model="externalUrlInput"
            :label="$t('pages.account.details.externalUrl')"
            :placeholder="$t('pages.account.details.externalUrlPlaceholder')"
            :show-error="showError"
            :disabled="isSaving"
          />
          <Button type="submit" :disabled="isSaveDisabled" :loading="isSaving">
            {{ $t('pages.account.details.save') }}
          </Button>
        </form>
      </Popover.PopoverContent>
    </Popover.Popover>
  </DesktopOnlyTooltip>
</template>
