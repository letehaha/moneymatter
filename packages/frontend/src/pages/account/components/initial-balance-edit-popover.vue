<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import DocsLink from '@/components/common/docs-link.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { ApiErrorResponseError } from '@/js/errors';
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
  initialBalance: props.account.initialBalance as number | null,
});

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  {
    form: {
      initialBalance: {
        required: validators.required,
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

const updateInitialBalance = async () => {
  if (!isFormValid()) return;

  const value = form.value.initialBalance;
  if (value === null) return;

  isSaving.value = true;
  try {
    await accountsStore.editAccount({
      id: props.account.id,
      initialBalance: value,
    });
    isOpen.value = false;
    addSuccessNotification(t('pages.account.details.initialBalanceUpdateSuccess'));
  } catch (e) {
    const message =
      e instanceof ApiErrorResponseError && e.data?.message
        ? e.data.message
        : t('pages.account.details.initialBalanceUpdateError');
    addErrorNotification(message);
  } finally {
    isSaving.value = false;
  }
};

watch([isOpen, () => props.account.id], () => {
  form.value.initialBalance = props.account.initialBalance;
  resetValidation();
});
</script>

<template>
  <DesktopOnlyTooltip :content="$t('pages.account.details.editInitialBalance')" :disabled="isOpen">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm" :aria-label="$t('pages.account.details.editInitialBalance')">
          <PencilIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent>
        <form class="grid gap-4" @submit.prevent="updateInitialBalance">
          <InputField
            v-model="form.initialBalance"
            type="number"
            :label="$t('pages.account.details.initialBalance')"
            :placeholder="$t('pages.account.details.initialBalancePlaceholder')"
            :error-message="getFieldErrorMessage('form.initialBalance')"
            @blur="touchField('form.initialBalance')"
          >
            <template #iconTrailing>
              <span class="text-muted-foreground text-sm">{{ currencyCode }}</span>
            </template>
          </InputField>
          <p class="text-muted-foreground text-xs">
            {{ $t('pages.account.details.initialBalanceHint') }}
            <DocsLink path="/accounts/manage-accounts/#change-the-initial-balance" class="text-xs" />
          </p>
          <Button
            type="submit"
            :disabled="form.initialBalance === null || form.initialBalance === account.initialBalance || isSaving"
            :loading="isSaving"
          >
            {{ $t('pages.account.details.save') }}
          </Button>
        </form>
      </Popover.PopoverContent>
    </Popover.Popover>
  </DesktopOnlyTooltip>
</template>
