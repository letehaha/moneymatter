<template>
  <Card class="@container/export-configure max-w-4xl">
    <CardHeader class="border-b">
      <RouterLink
        :to="{ name: ROUTES_NAMES.settingsDataManagementExport }"
        class="text-muted-foreground hover:text-foreground mb-3 inline-flex w-fit items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeftIcon class="size-4" />
        {{ $t('settings.dataManagement.export.form.back') }}
      </RouterLink>
      <h2 class="mb-2 text-2xl font-semibold text-balance">
        {{ $t('settings.dataManagement.export.form.title') }}
      </h2>
      <p class="text-sm opacity-80">{{ $t('settings.dataManagement.export.form.description') }}</p>
    </CardHeader>

    <CardContent class="mt-6 flex flex-col gap-8" :aria-busy="isPending">
      <PlanRestricted :feature="FEATURES.data_export" />

      <section>
        <Label class="mb-2 block text-sm font-medium">
          {{ $t('settings.dataManagement.export.format.label') }}
        </Label>
        <RadioGroup v-model="format" :disabled="isPending" class="flex flex-wrap gap-3">
          <div v-for="value in EXPORT_FORMATS" :key="value" class="flex items-center gap-2">
            <RadioGroupItem :id="`export-format-${value}`" :value="value" :disabled="isPending" />
            <Label :for="`export-format-${value}`" class="cursor-pointer text-sm">
              {{ $t(`settings.dataManagement.export.format.${value}`) }}
            </Label>
          </div>
        </RadioGroup>
      </section>

      <section>
        <Label class="mb-2 block text-sm font-medium">
          {{ $t('settings.dataManagement.export.dateRange.label') }}
        </Label>
        <p class="text-muted-foreground mb-2 text-xs">
          {{ $t('settings.dataManagement.export.dateRange.helper') }}
        </p>
        <div class="flex items-center gap-2">
          <DateSelectorDialog
            :model-value="dateSelectorPeriod"
            :allowed-filter-modes="['is', 'before', 'after', 'between']"
            @update:model-value="handlePeriodUpdate"
          >
            <template #trigger="{ triggerText }">
              <Button
                variant="outline"
                :disabled="isPending"
                :class="
                  cn('min-w-0 flex-1 justify-start text-left font-normal', !selectedPeriod && 'text-muted-foreground')
                "
              >
                <CalendarIcon class="mr-2 size-4 shrink-0" />
                <span class="truncate">
                  {{ selectedPeriod ? triggerText : $t('settings.dataManagement.export.dateRange.placeholder') }}
                </span>
              </Button>
            </template>
          </DateSelectorDialog>
          <Button
            v-if="selectedPeriod"
            variant="soft-destructive"
            size="icon"
            :disabled="isPending"
            :aria-label="$t('settings.dataManagement.export.dateRange.clear')"
            @click="clearPeriod"
          >
            <XIcon class="size-4" />
          </Button>
        </div>
      </section>

      <section>
        <Label class="mb-2 block text-sm font-medium">
          {{ $t('settings.dataManagement.export.accounts.label') }}
        </Label>
        <p class="text-muted-foreground mb-2 text-xs">
          {{ $t('settings.dataManagement.export.accounts.helper') }}
        </p>
        <AccountMultiSelectField
          include-archived
          :model-value="selectedAccountIds"
          :placeholder="$t('settings.dataManagement.export.accounts.placeholder')"
          :disabled="isPending"
          @update:model-value="(value) => (selectedAccountIds = value)"
        />
      </section>

      <section>
        <div class="mb-3 flex items-center justify-between">
          <Label class="text-sm font-medium">
            {{ $t('settings.dataManagement.export.groups.label') }}
          </Label>
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            :disabled="isPending"
            @click="toggleAll({ checked: !allSelected })"
          >
            {{
              allSelected
                ? $t('settings.dataManagement.export.groups.deselectAll')
                : $t('settings.dataManagement.export.groups.selectAll')
            }}
          </Button>
        </div>
        <div class="grid grid-cols-1 gap-3 @md/export-configure:grid-cols-2">
          <Label
            v-for="group in ALL_EXPORT_GROUPS"
            :key="group"
            :for="`export-group-${group}`"
            :class="
              cn(
                'group relative flex cursor-pointer flex-col gap-4 rounded-lg border p-4 transition-colors',
                selectedGroups.has(group) ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50',
              )
            "
          >
            <div class="flex items-start justify-between gap-3">
              <div
                :class="
                  cn(
                    'flex size-10 items-center justify-center rounded-lg transition-colors',
                    selectedGroups.has(group) ? 'bg-primary/10 text-primary-text' : 'bg-muted text-muted-foreground',
                  )
                "
              >
                <component :is="GROUP_ICONS[group]" class="size-5" />
              </div>
              <Checkbox
                :id="`export-group-${group}`"
                :model-value="selectedGroups.has(group)"
                :disabled="isPending"
                @update:model-value="(checked) => toggleGroup({ group, checked: checked === true })"
              />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-sm font-semibold">
                {{ $t(`settings.dataManagement.export.groups.${group}`) }}
              </span>
              <span class="text-muted-foreground text-xs leading-relaxed">
                {{ $t(`settings.dataManagement.export.groups.${group}Description`) }}
              </span>
            </div>
          </Label>
        </div>
      </section>

      <div class="flex justify-end gap-2 border-t pt-6">
        <RouterLink :to="{ name: ROUTES_NAMES.settingsDataManagementExport }">
          <Button variant="outline" :disabled="isPending">
            {{ $t('common.actions.cancel') }}
          </Button>
        </RouterLink>
        <DemoRestricted feature="data_export">
          <Button
            :disabled="noneSelected || isPending || userStore.isDemo || isFeatureGated(FEATURES.data_export)"
            @click="handleConfirm"
          >
            {{
              isPending
                ? $t('settings.dataManagement.export.form.confirmLoading')
                : $t('settings.dataManagement.export.form.confirmLabel')
            }}
          </Button>
        </DemoRestricted>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { DateSelectorDialog } from '@/components/lib/ui/date-selector';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { DataExportDownloadFailedError, useDataExport } from '@/composable/data-queries/data-export';
import { type Period } from '@/composable/use-period-navigation';
import { ApiErrorResponseError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes';
import { useUserStore } from '@/stores';
import {
  ALL_EXPORT_GROUPS,
  API_ERROR_CODES,
  EXPORT_FORMATS,
  FEATURES,
  type ExportDateRange,
  type ExportFormat,
  type ExportGroup,
} from '@bt/shared/types';
import {
  ArrowRightLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  RepeatIcon,
  TrendingUpIcon,
  WalletIcon,
  XIcon,
} from '@lucide/vue';
import { endOfMonth, format as formatDate, startOfMonth } from 'date-fns';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter, RouterLink } from 'vue-router';

defineOptions({
  name: 'settings-data-management-export-configure',
});

const router = useRouter();
const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const userStore = useUserStore();
const { isFeatureGated } = userStore;

const format = ref<ExportFormat>('json');
const selectedGroups = ref<Set<ExportGroup>>(new Set(ALL_EXPORT_GROUPS));
const selectedPeriod = ref<Period | null>(null);
const selectedAccountIds = ref<string[]>([]);

const GROUP_ICONS: Record<ExportGroup, typeof ArrowRightLeftIcon> = {
  transactions: ArrowRightLeftIcon,
  budgets: WalletIcon,
  subscriptions: RepeatIcon,
  investments: TrendingUpIcon,
};

const allSelected = computed(() => ALL_EXPORT_GROUPS.every((g) => selectedGroups.value.has(g)));
const noneSelected = computed(() => selectedGroups.value.size === 0);

const dateSelectorPeriod = computed<Period>(
  () => selectedPeriod.value ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) },
);

const dateRangePayload = computed<ExportDateRange | undefined>(() => {
  if (!selectedPeriod.value) return undefined;
  return {
    from: formatDate(selectedPeriod.value.from, 'yyyy-MM-dd'),
    to: formatDate(selectedPeriod.value.to, 'yyyy-MM-dd'),
  };
});

const handlePeriodUpdate = (period: Period) => {
  selectedPeriod.value = period;
};

const clearPeriod = () => {
  selectedPeriod.value = null;
};

const toggleGroup = ({ group, checked }: { group: ExportGroup; checked: boolean }) => {
  const next = new Set(selectedGroups.value);
  if (checked) next.add(group);
  else next.delete(group);
  selectedGroups.value = next;
};

const toggleAll = ({ checked }: { checked: boolean }) => {
  selectedGroups.value = checked ? new Set(ALL_EXPORT_GROUPS) : new Set();
};

const { mutate, isPending } = useDataExport();

const resolveErrorMessage = (e: unknown): string => {
  if (e instanceof ApiErrorResponseError) {
    if (e.data?.code === API_ERROR_CODES.payloadTooLarge) {
      return t('settings.dataManagement.export.notifications.tooLarge');
    }
    if (e.data?.message) return e.data.message;
  }
  if (e instanceof DataExportDownloadFailedError) {
    return t('settings.dataManagement.export.notifications.downloadBlocked');
  }
  return t('settings.dataManagement.export.notifications.failed');
};

const handleConfirm = () => {
  if (noneSelected.value || isPending.value) return;
  mutate(
    {
      format: format.value,
      groups: [...selectedGroups.value],
      dateRange: dateRangePayload.value,
      accountIds: selectedAccountIds.value,
    },
    {
      onSuccess: ({ totalRows }) => {
        addSuccessNotification(
          totalRows != null
            ? t('settings.dataManagement.export.notifications.successWithCount', { count: totalRows })
            : t('settings.dataManagement.export.notifications.success'),
        );
        router.push({ name: ROUTES_NAMES.settingsDataManagementExport });
      },
      onError: (e) => {
        // The API client already toasted the 402 with a "See plans" action.
        if (e instanceof ApiErrorResponseError && e.data?.code === API_ERROR_CODES.planRequired) return;
        addErrorNotification(resolveErrorMessage(e));
        const isExpected =
          e instanceof DataExportDownloadFailedError ||
          (e instanceof ApiErrorResponseError &&
            (e.data?.code === API_ERROR_CODES.payloadTooLarge || e.data?.code === API_ERROR_CODES.validationError));
        if (!isExpected) {
          captureException({ error: e, context: { feature: 'data-export', format: format.value } });
        }
      },
    },
  );
};
</script>
