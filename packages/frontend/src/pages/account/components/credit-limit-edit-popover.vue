<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import * as validators from '@/js/helpers/validators';
import { useAccountsStore } from '@/stores';
import { AccountModel } from '@bt/shared/types';
import { PencilIcon } from '@lucide/vue';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
  currencyCode: string;
}>();

const { t } = useI18n();
const accountsStore = useAccountsStore();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isOpen = ref(false);
const isSaving = ref(false);

const form = ref({
  creditLimit: props.account.creditLimit as number | null,
});

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  {
    form: {
      creditLimit: {
        required: validators.required,
        minValue: validators.minValue(0),
        currencyDecimal: validators.currencyDecimal,
      },
    },
  },
  undefined,
  {
    customValidationMessages: {
      currencyDecimal: t('forms.validators.invalidCurrencyDecimal'),
    },
  },
);

const updateCreditLimit = async () => {
  if (!isFormValid()) return;

  isSaving.value = true;
  try {
    await accountsStore.editAccount({
      id: props.account.id,
      creditLimit: form.value.creditLimit!,
    });
    isOpen.value = false;
    addSuccessNotification(t('pages.account.details.creditLimitUpdateSuccess'));
  } catch {
    addErrorNotification(t('pages.account.details.creditLimitUpdateError'));
  } finally {
    isSaving.value = false;
  }
};

watch([isOpen, () => props.account.id], () => {
  form.value.creditLimit = props.account.creditLimit;
  resetValidation();
});
</script>

<template>
  <DesktopOnlyTooltip :content="$t('pages.account.details.editCreditLimit')" :disabled="isOpen">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm">
          <PencilIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent>
        <form class="grid gap-4" @submit.prevent="updateCreditLimit">
          <InputField
            v-model="form.creditLimit"
            type="number"
            :label="$t('pages.account.details.creditLimit')"
            :only-positive="true"
            :error-message="getFieldErrorMessage('form.creditLimit')"
            @blur="touchField('form.creditLimit')"
          >
            <template #iconTrailing>
              <span class="text-muted-foreground text-sm">{{ currencyCode }}</span>
            </template>
          </InputField>
          <p class="text-muted-foreground text-xs">{{ $t('pages.account.details.creditLimitHint') }}</p>
          <Button
            type="submit"
            :disabled="form.creditLimit === null || form.creditLimit === account.creditLimit || isSaving"
            :loading="isSaving"
          >
            {{ $t('pages.account.details.save') }}
          </Button>
        </form>
      </Popover.PopoverContent>
    </Popover.Popover>
  </DesktopOnlyTooltip>
</template>
