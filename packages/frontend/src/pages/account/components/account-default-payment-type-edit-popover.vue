<script setup lang="ts">
import { NO_PAYMENT_TYPE_OPTION, NULLABLE_PAYMENT_TYPE_OPTIONS, type NullablePaymentTypeOption } from '@/common/const';
import SelectField from '@/components/fields/select-field.vue';
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
const selected = ref<NullablePaymentTypeOption | null>(null);
const currentValue = computed(() => props.account.defaultPaymentType ?? null);

const updateDefaultPaymentType = async () => {
  if (!selected.value || selected.value.value === currentValue.value) return;

  isSaving.value = true;
  try {
    await accountsStore.editAccount({
      id: props.account.id,
      defaultPaymentType: selected.value.value,
    });
    isOpen.value = false;
    addSuccessNotification(t('pages.account.details.defaultPaymentTypeUpdateSuccess'));
  } catch {
    addErrorNotification(t('pages.account.details.defaultPaymentTypeUpdateError'));
  } finally {
    isSaving.value = false;
  }
};

watch([isOpen, () => props.account.id], () => {
  selected.value =
    NULLABLE_PAYMENT_TYPE_OPTIONS.find((option) => option.value === currentValue.value) ?? NO_PAYMENT_TYPE_OPTION;
});
</script>

<template>
  <DesktopOnlyTooltip :content="$t('pages.account.details.editDefaultPaymentType')" :disabled="isOpen">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm">
          <PencilIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent>
        <form class="grid gap-4" @submit.prevent="updateDefaultPaymentType">
          <SelectField
            v-model="selected"
            :values="NULLABLE_PAYMENT_TYPE_OPTIONS"
            :label-key="(item) => $t(item.label)"
            :label="$t('pages.account.details.defaultPaymentType')"
          />
          <Button
            type="submit"
            :disabled="!selected || selected.value === currentValue || isSaving"
            :loading="isSaving"
          >
            {{ $t('pages.account.details.save') }}
          </Button>
        </form>
      </Popover.PopoverContent>
    </Popover.Popover>
  </DesktopOnlyTooltip>
</template>
