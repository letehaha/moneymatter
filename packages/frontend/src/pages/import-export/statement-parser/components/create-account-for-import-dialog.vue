<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ t('pages.statementParser.createAccountDialog.title') }}</template>
    <template #description>{{ t('pages.statementParser.createAccountDialog.description') }}</template>

    <form class="grid gap-6" @submit.prevent="handleSubmit">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InputField
            v-model="form.name"
            :label="t('pages.statementParser.createAccountDialog.accountNameLabel')"
            :placeholder="$t('pages.statementParser.accountNamePlaceholder')"
            :error="errors.name"
          />
        </div>
        <LogoSquareField
          v-model="form.logo"
          :name-for-search="form.name"
          :reset-label="$t('common.logo.remove')"
          size-class="size-10 rounded-lg"
          align="with-labeled-field"
        >
          <template #placeholder>
            <AccountLogo :account="logoPlaceholderAccount" class="size-10 rounded-lg" />
          </template>
        </LogoSquareField>
      </div>

      <!--
        Currency field is disabled when defaultCurrency is provided from statement.
        It makes no sense to allow changing currency if the statement has a specific currency -
        the account must match the statement currency for proper transaction import.
      -->
      <div>
        <FieldLabel :label="t('pages.statementParser.createAccountDialog.currencyLabel')">
          <Select.Select v-model="form.currencyCode" :disabled="!!props.defaultCurrency">
            <Select.SelectTrigger>
              <Select.SelectValue :placeholder="$t('pages.statementParser.selectCurrency')" />
            </Select.SelectTrigger>
            <Select.SelectContent>
              <!-- Show statement currency first if it exists and is not in linked list -->
              <template v-if="props.defaultCurrency && !isCurrencyLinked">
                <Select.SelectItem :value="props.defaultCurrency">
                  {{ props.defaultCurrency }} {{ t('pages.statementParser.createAccountDialog.fromStatement') }}
                </Select.SelectItem>
                <div class="my-1 border-t" />
              </template>
              <template v-for="item of systemCurrenciesVerbose.linked" :key="item.code">
                <Select.SelectItem :value="String(item.code)">
                  {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
                </Select.SelectItem>
              </template>
            </Select.SelectContent>
          </Select.Select>
        </FieldLabel>
        <p v-if="props.defaultCurrency" class="text-muted-foreground mt-1 text-xs">
          {{ t('pages.statementParser.createAccountDialog.currencyLocked', { currency: props.defaultCurrency }) }}
        </p>
        <p v-if="props.defaultCurrency && !isCurrencyLinked" class="text-warning-text mt-1 text-xs">
          {{ t('pages.statementParser.createAccountDialog.currencyWillBeAdded', { currency: props.defaultCurrency }) }}
        </p>
      </div>

      <div class="flex gap-3">
        <Button type="button" variant="outline" class="flex-1" @click="isOpen = false">
          {{ t('pages.statementParser.createAccountDialog.cancel') }}
        </Button>
        <Button type="submit" class="flex-1" :disabled="isLoading || !form.currencyCode">
          {{
            isLoading
              ? t('pages.statementParser.createAccountDialog.creating')
              : t('pages.statementParser.createAccountDialog.createAccount')
          }}
        </Button>
      </div>
    </form>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { createAccount as apiCreateAccount } from '@/api';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import AccountLogo from '@/components/common/account-logo.vue';
import { type LogoSelection, toOptionalLogoPayload } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { extractApiErrorMessage } from '@/js/errors';
import { useCurrenciesStore } from '@/stores';
import { ACCOUNT_CATEGORIES, type AccountModel } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  open?: boolean;
  defaultCurrency?: string;
  defaultName?: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  created: [account: AccountModel];
}>();

const queryClient = useQueryClient();
const currenciesStore = useCurrenciesStore();
const { addNotification } = useNotificationCenter();
const { formatCurrencyLabel } = useCurrencyName();

const { baseCurrency, systemCurrenciesVerbose } = storeToRefs(currenciesStore);

const isOpen = computed({
  get: () => props.open ?? false,
  set: (value) => emit('update:open', value),
});

/**
 * Get the currency to use for the new account.
 * Priority:
 * 1. props.defaultCurrency (from statement metadata) if it's in the user's linked currencies
 * 2. props.defaultCurrency even if not linked (user might want to add it)
 * 3. User's base currency as fallback
 */
const getInitialCurrency = () => {
  if (props.defaultCurrency) {
    return props.defaultCurrency;
  }
  return baseCurrency.value?.currencyCode || '';
};

const form = reactive<{
  name: string;
  currencyCode: string;
  logo: LogoSelection | null;
}>({
  name: '',
  currencyCode: getInitialCurrency(),
  logo: null,
});

const errors = reactive({
  name: '',
});

const isLoading = ref(false);

const logoPlaceholderAccount = computed(() => ({
  name: form.name,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  accountCategory: ACCOUNT_CATEGORIES.general,
}));

// Check if the selected currency is in the linked list
const isCurrencyLinked = computed(() => {
  return systemCurrenciesVerbose.value.linked.some((c) => c.code === form.currencyCode);
});

// Reset form when dialog opens - use the prop values directly
watch(
  () => props.open,
  (open) => {
    if (open) {
      // Prefill with bank name if available from statement
      form.name = props.defaultName || '';
      // Always use the prop value when dialog opens
      form.currencyCode = props.defaultCurrency || baseCurrency.value?.currencyCode || '';
      form.logo = null;
      errors.name = '';
    }
  },
);

// Also watch for changes to defaultCurrency prop while dialog is open
watch(
  () => props.defaultCurrency,
  (newCurrency) => {
    if (newCurrency && isOpen.value) {
      form.currencyCode = newCurrency;
    }
  },
);

async function handleSubmit() {
  // Validate
  errors.name = '';

  if (!form.name.trim()) {
    errors.name = t('pages.statementParser.createAccountDialog.validation.nameRequired');
    return;
  }

  if (!form.currencyCode) {
    addNotification({
      text: t('pages.statementParser.createAccountDialog.validation.currencyRequired'),
      type: NotificationType.error,
    });
    return;
  }

  isLoading.value = true;

  try {
    const account = await apiCreateAccount({
      name: form.name.trim(),
      currencyCode: form.currencyCode,
      accountCategory: ACCOUNT_CATEGORIES.general,
      initialBalance: 0,
      creditLimit: 0,
      ...toOptionalLogoPayload({ selection: form.logo }),
    });

    await queryClient.invalidateQueries({
      queryKey: VUE_QUERY_CACHE_KEYS.allAccounts,
    });

    addNotification({
      text: t('pages.statementParser.createAccountDialog.success'),
      type: NotificationType.success,
    });

    emit('created', account);
    isOpen.value = false;
  } catch (error) {
    addNotification({
      text: extractApiErrorMessage(error) || t('pages.statementParser.createAccountDialog.error'),
      type: NotificationType.error,
    });
  } finally {
    isLoading.value = false;
  }
}
</script>
