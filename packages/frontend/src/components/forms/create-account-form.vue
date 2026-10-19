<script setup lang="ts">
import { createAccount } from '@/api';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const/account-categories-verbose';
import AccountLogo from '@/components/common/account-logo.vue';
import DocsLink from '@/components/common/docs-link.vue';
import { type LogoSelection, toOptionalLogoPayload } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { useFormValidation } from '@/composable/form-validator';
import * as validators from '@/js/helpers/validators';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { useCurrenciesStore } from '@/stores';
import { useOnboardingStore } from '@/stores/onboarding';
import { ACCOUNT_CATEGORIES, isDedicatedFlowAccountCategory } from '@bt/shared/types';
import { PlusIcon } from '@lucide/vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, defineAsyncComponent, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

const AddCurrencyDialog = defineAsyncComponent(() => import('@/components/dialogs/add-currency-dialog.vue'));

const emit = defineEmits(['created']);

const { t } = useI18n();
const route = useRoute();
const queryClient = useQueryClient();
const currenciesStore = useCurrenciesStore();
const { addNotification } = useNotificationCenter();
const { formatCurrencyLabel } = useCurrencyName();

const { baseCurrency, systemCurrenciesVerbose } = storeToRefs(currenciesStore);

const defaultCurrency = computed(
  () => systemCurrenciesVerbose.value.linked.find((i) => i.code === baseCurrency.value!.currencyCode)!.code || '',
);

const queryCategory = route.query.category as ACCOUNT_CATEGORIES | undefined;
const defaultAccountCategory =
  queryCategory && !isDedicatedFlowAccountCategory(queryCategory) ? queryCategory : ACCOUNT_CATEGORIES.general;

const form = reactive<{
  name: string;
  currencyCode: string;
  accountCategory: ACCOUNT_CATEGORIES;
  initialBalance: number;
  creditLimit: number;
  /** Chosen brand or monogram. null = no logo; the account renders its account-type chip (accounts have no auto-resolution). */
  logo: LogoSelection | null;
}>({
  name: '',
  currencyCode: String(defaultCurrency.value),
  accountCategory: defaultAccountCategory,
  initialBalance: 0,
  creditLimit: 0,
  logo: null,
});

const { isFormValid, touchField, getFieldErrorMessage } = useFormValidation(
  { form },
  { form: { name: { required: validators.required } } },
);

const logoPlaceholderAccount = computed(() => ({
  name: form.name,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  accountCategory: form.accountCategory,
}));

const selectableAccountCategories = computed(() =>
  Object.entries(ACCOUNT_CATEGORIES_TRANSLATION_KEYS).filter(
    ([category]) => !isDedicatedFlowAccountCategory(category as ACCOUNT_CATEGORIES),
  ),
);

const createAccountMutation = useMutation({ mutationFn: createAccount });

const submit = async () => {
  if (createAccountMutation.isPending.value || !isFormValid()) return;

  try {
    await createAccountMutation.mutateAsync({
      currencyCode: form.currencyCode,
      name: form.name.trim(),
      accountCategory: form.accountCategory,
      creditLimit: form.creditLimit,
      initialBalance: form.initialBalance,
      ...toOptionalLogoPayload({ selection: form.logo }),
    });

    trackAnalyticsEvent({
      event: 'account_created',
      properties: {
        currency: form.currencyCode,
      },
    });

    addNotification({
      text: t('forms.createAccount.notifications.success'),
      type: NotificationType.success,
    });

    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange);
      },
    });

    useOnboardingStore().completeTask('create-account');

    emit('created');
  } catch (error) {
    addNotification({
      text: error instanceof Error ? error.message : t('forms.createAccount.notifications.error'),
      type: NotificationType.error,
    });
  }
};
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <input-field
          v-model="form.name"
          :label="$t('forms.createAccount.nameLabel')"
          :placeholder="$t('forms.createAccount.namePlaceholder')"
          :error-message="getFieldErrorMessage('form.name')"
          @blur="touchField('form.name')"
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

    <div>
      <FieldLabel :label="$t('forms.createAccount.currencyLabel')">
        <Select.Select v-model="form.currencyCode">
          <Select.SelectTrigger>
            <Select.SelectValue :placeholder="$t('forms.createAccount.currencyPlaceholder')" />
          </Select.SelectTrigger>
          <Select.SelectContent>
            <template v-for="item of systemCurrenciesVerbose.linked" :key="item.code">
              <Select.SelectItem :value="String(item.code)">
                {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
              </Select.SelectItem>
            </template>

            <AddCurrencyDialog @added="form.currencyCode = String($event)">
              <ui-button type="button" class="mt-4 w-full" variant="link">
                <PlusIcon class="size-4" />
                {{ $t('forms.createAccount.addCurrencyButton') }}
              </ui-button>
            </AddCurrencyDialog>
          </Select.SelectContent>
        </Select.Select>
      </FieldLabel>
    </div>

    <input-field
      v-model="form.initialBalance"
      type="number"
      :label="$t('forms.createAccount.initialBalanceLabel')"
      :placeholder="$t('forms.createAccount.initialBalancePlaceholder')"
    >
      <template #label-right>
        <DocsLink path="/accounts/create-an-account/#choose-the-right-initial-balance" class="text-xs">
          {{ $t('forms.createAccount.initialBalanceHelpLink') }}
        </DocsLink>
      </template>
    </input-field>

    <FieldLabel :label="$t('forms.createAccount.accountCategoryLabel')">
      <Select.Select v-model="form.accountCategory">
        <Select.SelectTrigger>
          <Select.SelectValue :placeholder="$t('forms.createAccount.accountCategoryPlaceholder')" />
        </Select.SelectTrigger>
        <Select.SelectContent>
          <template v-for="[category, labelKey] in selectableAccountCategories" :key="category">
            <Select.SelectItem :value="category">
              {{ t(labelKey) }}
            </Select.SelectItem>
          </template>
        </Select.SelectContent>
      </Select.Select>
    </FieldLabel>

    <input-field
      v-model="form.creditLimit"
      type="number"
      :label="$t('forms.createAccount.creditLimitLabel')"
      :placeholder="$t('forms.createAccount.creditLimitPlaceholder')"
    />

    <div class="flex">
      <ui-button type="submit" class="ml-auto min-w-30" :disabled="createAccountMutation.isPending.value">
        {{
          createAccountMutation.isPending.value
            ? $t('forms.createAccount.submitButtonLoading')
            : $t('forms.createAccount.submitButton')
        }}
      </ui-button>
    </div>
  </form>
</template>
