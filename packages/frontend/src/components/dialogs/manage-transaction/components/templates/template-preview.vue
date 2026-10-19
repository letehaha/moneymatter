<script lang="ts" setup>
import { VERBOSE_PAYMENT_TYPES } from '@/common/const';
import AccountLogo from '@/components/common/account-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import CategoryCircle from '@/components/common/category-circle.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { formatUIAmount } from '@/js/helpers';
import { useTagsStore } from '@/stores';
import { TRANSACTION_TYPES, type TransactionTemplateModel } from '@bt/shared/types';
import { PencilIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { TemplateFormSources } from '../../utils/template-to-form';
import { TEMPLATE_STALE_REASON_KEYS, type TemplateStaleReason } from './template-staleness';
import { EMPTY_FIELD_LABEL } from './use-template-list';

const props = defineProps<{
  template: TransactionTemplateModel;
  sources: TemplateFormSources;
  staleReason: TemplateStaleReason | null;
}>();

const emit = defineEmits<{ edit: [] }>();

const { t } = useI18n();
const { tagsMap } = storeToRefs(useTagsStore());
const { byId: payeeById } = usePayeeLookup();

const isIncome = computed(() => props.template.transactionType === TRANSACTION_TYPES.income);

const pinnedAccount = computed(() =>
  props.template.accountId
    ? (props.sources.sourceAccounts.find((account) => account.id === props.template.accountId) ?? null)
    : null,
);

const amountLabel = computed(() => {
  if (props.template.amount == null) return t('dialogs.manageTransaction.templates.noAmount');
  // The amount is stored in the pinned account's currency; without it `formatUIAmount` would
  // silently fall back to `$`.
  const currency = pinnedAccount.value?.currencyCode;
  return currency ? formatUIAmount(props.template.amount, { currency }) : EMPTY_FIELD_LABEL;
});

const isAccountUnavailable = computed(() => Boolean(props.template.accountId) && !pinnedAccount.value);

const accountLabel = computed(() =>
  props.template.accountId == null
    ? t('dialogs.manageTransaction.templates.keepsAccount')
    : t('dialogs.manageTransaction.templates.stale.accountUnavailable'),
);

const category = computed(() =>
  props.template.categoryId ? (props.sources.categoriesMap[props.template.categoryId] ?? null) : null,
);

const payee = computed(() => (props.template.payeeId ? (payeeById.value.get(props.template.payeeId) ?? null) : null));

const tags = computed(() => props.template.tagIds.flatMap((id) => tagsMap.value[id] ?? []));

const paymentTypeLabel = computed(() => {
  const match = VERBOSE_PAYMENT_TYPES.find((item) => item.value === props.template.paymentType);
  return match ? t(match.label) : null;
});
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div :class="['h-1 shrink-0', isIncome ? 'bg-app-income-color' : 'bg-app-expense-color']" />

    <div class="flex items-start gap-2 px-3 pt-3">
      <div class="min-w-0 flex-1">
        <p class="truncate text-base font-bold tracking-tight">{{ template.name }}</p>
        <p
          :class="
            cn(
              'tabular-nums',
              template.amount == null
                ? 'text-muted-foreground text-[13px] font-medium'
                : ['text-[15px] font-bold', isIncome ? 'text-app-income-color' : 'text-app-expense-color'],
            )
          "
        >
          {{ amountLabel }}
        </p>
      </div>

      <DesktopOnlyTooltip :content="$t('dialogs.manageTransaction.templates.edit')">
        <Button
          size="icon-sm"
          variant="ghost"
          class="text-muted-foreground -mt-1 -mr-1 shrink-0"
          :aria-label="$t('dialogs.manageTransaction.templates.edit')"
          @click="emit('edit')"
        >
          <PencilIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-3 py-3 text-xs">
        <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.accountLabel') }}</dt>
        <dd v-if="pinnedAccount" class="flex min-w-0 items-center gap-1.5">
          <AccountLogo :account="pinnedAccount" class="size-5 shrink-0" />
          <span class="truncate">{{ pinnedAccount.name }}</span>
        </dd>
        <dd v-else :class="isAccountUnavailable ? 'text-warning-text' : 'text-foreground'">{{ accountLabel }}</dd>

        <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.categoryLabel') }}</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <template v-if="category">
            <CategoryCircle :category="category" class="shrink-0" />
            <span class="truncate">{{ category.name }}</span>
          </template>
          <span v-else :class="staleReason === 'categoryDeleted' ? 'text-warning-text' : 'text-muted-foreground'">
            {{ staleReason === 'categoryDeleted' ? $t(TEMPLATE_STALE_REASON_KEYS.categoryDeleted) : EMPTY_FIELD_LABEL }}
          </span>
        </dd>

        <template v-if="payee">
          <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.payeeLabel') }}</dt>
          <dd class="flex min-w-0 items-center gap-1.5">
            <BrandLogo v-bind="toEntityLogoDisplayProps(payee)" :name="payee.name" class="size-5 shrink-0" />
            <span class="truncate">{{ payee.name }}</span>
          </dd>
        </template>

        <template v-if="tags.length">
          <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.tagsLabel') }}</dt>
          <dd class="flex flex-wrap gap-1">
            <span
              v-for="tag in tags"
              :key="tag.id"
              class="inline-block max-w-37.5 truncate rounded-full px-2 py-0.5 text-xs font-medium text-white/90"
              :style="{ backgroundColor: tag.color }"
            >
              {{ tag.name }}
            </span>
          </dd>
        </template>

        <template v-if="paymentTypeLabel">
          <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.paymentTypeLabel') }}</dt>
          <dd class="truncate">{{ paymentTypeLabel }}</dd>
        </template>

        <template v-if="template.originalCurrencyCode">
          <dt class="text-muted-foreground">
            {{ $t('dialogs.manageTransaction.templates.form.originalCurrencyLabel') }}
          </dt>
          <dd class="truncate">{{ template.originalCurrencyCode }}</dd>
        </template>

        <template v-if="template.note">
          <dt class="text-muted-foreground">{{ $t('dialogs.manageTransaction.form.noteLabel') }}</dt>
          <dd class="whitespace-pre-line">{{ template.note }}</dd>
        </template>
      </dl>
    </ScrollArea>
  </div>
</template>
