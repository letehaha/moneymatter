<script setup lang="ts">
import { normalizeExternalUrl, validateOptionalExternalUrl } from '@/common/utils/external-url';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DisplayCurrencySelect from '@/components/fields/display-currency-select.vue';
import ExternalUrlField from '@/components/fields/external-url-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import * as Select from '@/components/lib/ui/select';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useCreatePortfolio } from '@/composable/data-queries/portfolios';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { CheckIcon } from '@lucide/vue';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addNotification } = useNotificationCenter();

const emit = defineEmits<{ created: [] }>();

const isOpen = ref(false);

const form = reactive({
  name: '',
  portfolioType: PORTFOLIO_TYPE.investment,
  description: '',
  displayCurrencyCode: null as string | null,
  externalUrl: '',
});

// Portfolio type options for the select dropdown
const portfolioTypeOptions = computed(() => [
  { value: PORTFOLIO_TYPE.investment, label: t('dialogs.createPortfolio.form.portfolioTypes.investment') },
  { value: PORTFOLIO_TYPE.retirement, label: t('dialogs.createPortfolio.form.portfolioTypes.retirement') },
  { value: PORTFOLIO_TYPE.savings, label: t('dialogs.createPortfolio.form.portfolioTypes.savings') },
  { value: PORTFOLIO_TYPE.other, label: t('dialogs.createPortfolio.form.portfolioTypes.other') },
]);

const createPortfolioMutation = useCreatePortfolio();

const isSubmitDisabled = computed(
  () =>
    createPortfolioMutation.isPending.value ||
    !form.name.trim() ||
    validateOptionalExternalUrl({ value: form.externalUrl }) !== null,
);

const resetForm = () => {
  form.name = '';
  form.portfolioType = PORTFOLIO_TYPE.investment;
  form.description = '';
  form.displayCurrencyCode = null;
  form.externalUrl = '';
};

const onPortfolioCreation = () => {
  isOpen.value = false;
  resetForm();
  emit('created');
};

const createPortfolio = async () => {
  const normalizedExternalUrl = normalizeExternalUrl({ value: form.externalUrl });
  try {
    await createPortfolioMutation.mutateAsync({
      name: form.name.trim(),
      portfolioType: form.portfolioType,
      description: form.description.trim() || undefined,
      displayCurrencyCode: form.displayCurrencyCode,
      externalUrl: normalizedExternalUrl ?? undefined,
      isEnabled: true,
    });

    addNotification({
      text: t('dialogs.createPortfolio.notifications.success'),
      type: NotificationType.success,
    });

    onPortfolioCreation();
  } catch {
    addNotification({
      text: t('dialogs.createPortfolio.notifications.error'),
      type: NotificationType.error,
    });
  }
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #trigger>
      <slot />
    </template>

    <template #title>{{ $t('dialogs.createPortfolio.title') }}</template>

    <template #description> {{ $t('dialogs.createPortfolio.description') }} </template>

    <form class="mt-4 grid gap-6" @submit.prevent="createPortfolio">
      <Callout>
        <i18n-t keypath="dialogs.createPortfolio.assetSupportNotice" tag="p">
          <template #roadmapLink>
            <a
              :href="EXTERNAL_URLS.featurebaseRoadmap"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline underline-offset-2 hover:no-underline"
            >
              {{ $t('dialogs.createPortfolio.assetSupportRoadmapLink') }}
            </a>
          </template>
          <template #feedbackLink>
            <a
              :href="EXTERNAL_URLS.featurebaseBoard"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline underline-offset-2 hover:no-underline"
            >
              {{ $t('dialogs.createPortfolio.assetSupportFeedbackLink') }}
            </a>
          </template>
        </i18n-t>
      </Callout>

      <InputField
        v-model="form.name"
        :label="$t('dialogs.createPortfolio.form.nameLabel')"
        :placeholder="$t('dialogs.createPortfolio.form.namePlaceholder')"
        :disabled="createPortfolioMutation.isPending.value"
      />

      <div>
        <FieldLabel :label="$t('dialogs.createPortfolio.form.typeLabel')">
          <Select.Select v-model="form.portfolioType" :disabled="createPortfolioMutation.isPending.value">
            <Select.SelectTrigger>
              <Select.SelectValue :placeholder="$t('dialogs.createPortfolio.form.typePlaceholder')" />
            </Select.SelectTrigger>
            <Select.SelectContent>
              <Select.SelectItem v-for="option in portfolioTypeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </Select.SelectItem>
            </Select.SelectContent>
          </Select.Select>
        </FieldLabel>
      </div>

      <DisplayCurrencySelect v-model="form.displayCurrencyCode" :disabled="createPortfolioMutation.isPending.value" />

      <TextareaField
        v-model="form.description"
        :label="$t('dialogs.createPortfolio.form.descriptionLabel')"
        :placeholder="$t('dialogs.createPortfolio.form.descriptionPlaceholder')"
        :disabled="createPortfolioMutation.isPending.value"
      />

      <ExternalUrlField
        v-model="form.externalUrl"
        :label="$t('dialogs.createPortfolio.form.externalUrlLabel')"
        :placeholder="$t('dialogs.createPortfolio.form.externalUrlPlaceholder')"
        :disabled="createPortfolioMutation.isPending.value"
      />

      <div class="flex">
        <UiButton type="submit" class="ml-auto min-w-30" :disabled="isSubmitDisabled">
          <CheckIcon class="size-4" />
          {{
            createPortfolioMutation.isPending.value
              ? $t('dialogs.createPortfolio.form.submitButtonLoading')
              : $t('dialogs.createPortfolio.form.submitButton')
          }}
        </UiButton>
      </div>
    </form>
  </ResponsiveDialog>
</template>
