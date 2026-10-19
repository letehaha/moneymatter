<template>
  <div class="@container/detail space-y-4">
    <Card class="overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <RouterLink
          :to="{ name: ROUTES_NAMES.settingsPayees }"
          class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium transition-colors"
        >
          <ChevronLeftIcon class="size-4" />
          {{ $t('payees.title') }}
        </RouterLink>
        <PayeeActionsDropdown
          :disabled="!payeeData"
          @rename="openRename"
          @merge="openMerge"
          @delete="openDelete"
          @delete-and-ignore="openDeleteAndIgnore"
        />
      </div>

      <div class="mt-3 flex items-center gap-3 px-5 sm:px-6">
        <div class="group relative shrink-0">
          <BrandLogo
            v-bind="toEntityLogoDisplayProps(payeeData ?? {})"
            :name="payeeData?.name ?? ''"
            class="size-11 text-lg"
          />
          <DesktopOnlyTooltip :content="$t('payees.logo.change')">
            <Button
              variant="ghost"
              size="icon"
              class="bg-background/80 hover:bg-background absolute inset-0 size-full rounded-lg opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
              :aria-label="$t('payees.logo.change')"
              :disabled="!payeeData"
              @click="logoPickerOpen = true"
            >
              <PencilIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
        <h2 class="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">
          {{ payeeData?.name ?? '…' }}
        </h2>
      </div>

      <div
        v-if="payeeData?.stats"
        class="divide-border border-border bg-muted/30 mx-5 mt-5 flex flex-col divide-y overflow-hidden rounded-lg border sm:mx-6 @[650px]/detail:grid @[650px]/detail:grid-cols-3 @[650px]/detail:divide-x @[650px]/detail:divide-y-0"
      >
        <button
          type="button"
          :disabled="payeeData.stats.transactionCount === 0"
          class="enabled:hover:bg-muted/40 focus-visible:ring-ring flex flex-row items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none enabled:cursor-pointer disabled:cursor-default @[650px]/detail:flex-col @[650px]/detail:items-start @[650px]/detail:gap-1.5"
          @click="openTransactionsDialog"
        >
          <span class="text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase">
            {{ $t('payees.columns.transactionCount') }}
          </span>
          <span class="text-lg font-semibold tabular-nums @[650px]/detail:text-2xl">
            {{ payeeData.stats.transactionCount }}
          </span>
        </button>

        <div
          class="flex flex-row items-center justify-between gap-3 px-4 py-3 @[650px]/detail:flex-col @[650px]/detail:items-start @[650px]/detail:gap-1.5"
        >
          <span class="text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase">
            {{ $t('payees.columns.netFlow') }}
          </span>
          <span
            class="text-lg font-semibold tabular-nums @[650px]/detail:text-2xl"
            :class="netFlowToneClass(payeeData.stats.netFlowRef)"
          >
            {{ formatNetFlow(payeeData.stats.netFlowRef) }}
          </span>
        </div>

        <div
          class="flex flex-row items-center justify-between gap-3 px-4 py-3 @[650px]/detail:flex-col @[650px]/detail:items-start @[650px]/detail:gap-1.5"
        >
          <span
            class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.07em] uppercase"
          >
            {{ $t('payees.columns.topCategory') }}
            <ResponsiveTooltip :delay-duration="100" :content="$t('payees.detail.topCategoryHint')">
              <InfoIcon class="size-3.5 cursor-help" @click.prevent.stop />
            </ResponsiveTooltip>
          </span>
          <span class="flex min-w-0 items-center gap-2 text-base font-semibold @[650px]/detail:text-lg">
            <CategoryCircle
              v-if="payeeData.stats.topCategoryId"
              :category-id="payeeData.stats.topCategoryId"
              class="size-5 shrink-0"
            />
            <span class="truncate">{{ categoryName(payeeData.stats.topCategoryId) || '–' }}</span>
          </span>
        </div>
      </div>

      <div v-if="payeeData" class="border-border mt-6 border-t px-5 pt-5 pb-5 sm:px-6 sm:pt-6 sm:pb-6">
        <h3 class="mb-4 text-sm font-semibold">
          {{ $t('payees.detail.categorizationSection') }}
        </h3>
        <div class="grid gap-5 @[650px]/detail:grid-cols-2 @[650px]/detail:gap-6">
          <div class="flex flex-col gap-1.5">
            <label class="text-foreground text-sm font-medium">
              {{ $t('payees.columns.defaultCategory') }}
            </label>
            <CategorySelectField
              v-model="defaultCategoryProxy"
              :values="formattedCategories"
              label-key="name"
              :placeholder="$t('payees.detail.defaultCategoryPlaceholder')"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-foreground text-sm font-medium">
              {{ $t('payees.form.categorizationMode.label') }}
            </label>
            <SelectField
              v-model="categorizationModeProxy"
              :values="categorizationModeOptions"
              label-key="label"
              value-key="value"
            />
            <p class="text-muted-foreground text-[13px] leading-snug">
              {{ categorizationModeProxy.hint }}
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-foreground text-sm font-medium">
              {{ $t('payees.detail.defaultTagsLabel') }}
            </label>
            <TagSelectField v-model="defaultTagsProxy" :placeholder="$t('payees.detail.defaultTagsPlaceholder')" />
            <p class="text-muted-foreground text-[13px] leading-snug">
              {{ $t('payees.detail.defaultTagsHint') }}
            </p>
            <div v-if="canApplyTagsToExisting" class="mt-1">
              <Button
                variant="outline"
                size="sm"
                :disabled="applyTagsMut.isPending.value"
                @click="handleApplyTagsToExisting"
              >
                {{ $t('payees.detail.applyTagsToExisting') }}
              </Button>
            </div>
          </div>

          <PayeeDefaultLocationField :payee-id="payeeData.id" :default-location="payeeData.defaultLocation" />
        </div>
      </div>
    </Card>

    <Card class="px-5 py-5 sm:px-6 sm:py-6">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="flex items-center gap-2 text-sm font-semibold">
          {{ $t('payees.detail.aliasesHeading') }}
          <span
            class="bg-muted text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums"
          >
            {{ payeeData?.aliases?.length ?? 0 }}
          </span>
        </h3>
        <Button variant="outline" size="sm" :disabled="!payeeData" @click="openAddAlias">
          <PlusIcon class="size-4" />
          {{ $t('payees.detail.addAlias') }}
        </Button>
      </div>

      <ul
        v-if="payeeData?.aliases && payeeData.aliases.length > 0"
        class="divide-border border-border mt-3 divide-y overflow-hidden rounded-md border"
      >
        <li
          v-for="alias in payeeData.aliases"
          :key="alias.id"
          class="hover:bg-muted/30 flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors"
        >
          <span class="truncate font-medium">{{ alias.rawName }}</span>
          <DesktopOnlyTooltip
            :content="
              alias.isCanonical
                ? $t('payees.detail.cannotDeleteCanonicalAlias')
                : $t('payees.detail.deleteAliasConfirm')
            "
          >
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :disabled="alias.isCanonical"
              :aria-label="$t('payees.detail.deleteAliasConfirm')"
              @click="confirmDeleteAlias(alias.id)"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </li>
      </ul>

      <div
        v-else
        class="border-border bg-muted/20 text-muted-foreground mt-3 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center"
      >
        <TagsIcon class="size-5" />
        <p class="text-sm leading-snug">{{ $t('payees.detail.aliasesEmpty') }}</p>
      </div>
    </Card>

    <PayeeLogoPicker
      v-if="payeeData"
      v-model:open="logoPickerOpen"
      :payee-id="payeeData.id"
      :payee-name="payeeData.name"
      :current-domain="payeeData.logoDomain ?? null"
      :current-initials="payeeData.logoInitials ?? null"
      :current-color="payeeData.logoColor ?? null"
    />

    <PayeeFormDialog v-model:open="renameOpen" :payee="payeeData ?? null" @saved="refetch()" />

    <ResponsiveAlertDialog
      v-model:open="deleteOpen"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      @confirm="handleDelete"
    >
      <template #title>{{ $t('payees.detail.deletePayeeTitle') }}</template>
      <template #description>{{ $t('payees.detail.deletePayeeDescription') }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="deleteAndIgnoreOpen"
      :confirm-label="$t('payees.actions.deleteAndIgnore')"
      confirm-variant="destructive"
      @confirm="handleDeleteAndIgnore"
    >
      <template #title>{{ $t('payees.detail.deleteAndIgnoreTitle') }}</template>
      <template #description>{{ $t('payees.detail.deleteAndIgnoreDescription') }}</template>
    </ResponsiveAlertDialog>

    <PayeeTransactionsDialog
      v-model:open="transactionsDialogOpen"
      :payee-id="payeeData?.id ?? null"
      :payee-name="payeeData?.name ?? null"
    />

    <ResponsiveDialog v-model:open="addAliasOpen">
      <template #title>
        <span class="text-lg font-semibold">{{ $t('payees.detail.addAliasTitle') }}</span>
      </template>
      <template #description>{{ $t('payees.detail.addAliasDescription') }}</template>
      <template #default>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <InputField
              v-model="aliasInput"
              :label="$t('payees.detail.addAliasInputLabel')"
              :placeholder="$t('payees.detail.addAliasPlaceholder')"
              @update:model-value="aliasError = null"
              @keydown.enter="handleAddAlias"
            />
            <p v-if="aliasError" class="text-destructive-text text-xs leading-snug">
              <template v-if="aliasError.conflictingPayee">
                <i18n-t keypath="payees.detail.aliasUsedByOtherPayee" tag="span">
                  <template #name>
                    <RouterLink
                      :to="{
                        name: ROUTES_NAMES.settingsPayeeDetail,
                        params: { id: aliasError.conflictingPayee.id },
                      }"
                      class="font-medium underline underline-offset-2"
                    >
                      {{ aliasError.conflictingPayee.name }}
                    </RouterLink>
                  </template>
                </i18n-t>
              </template>
              <template v-else>
                {{ aliasError.message }}
              </template>
            </p>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" :disabled="createAliasMut.isPending.value" @click="addAliasOpen = false">
              {{ $t('common.actions.cancel') }}
            </Button>
            <Button
              variant="default"
              :disabled="!aliasInput.trim() || createAliasMut.isPending.value"
              @click="handleAddAlias"
            >
              {{ $t('common.actions.save') }}
            </Button>
          </div>
        </div>
      </template>
    </ResponsiveDialog>

    <ResponsiveDialog v-model:open="mergeOpen">
      <template #default>
        <div class="flex flex-col gap-4 p-4">
          <h3 class="text-lg font-semibold">{{ $t('payees.detail.mergeTitle') }}</h3>
          <p class="text-muted-foreground text-sm">{{ $t('payees.detail.mergeDescription') }}</p>
          <PayeeSelectField v-model="mergeTargetId" :label="$t('payees.actions.merge')" :exclude-id="payeeData?.id" />
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" @click="mergeOpen = false">{{ $t('common.actions.cancel') }}</Button>
            <Button variant="default" :disabled="!mergeTargetId" @click="handleMerge">
              {{ $t('payees.detail.confirmMerge') }}
            </Button>
          </div>
        </div>
      </template>
    </ResponsiveDialog>
  </div>
</template>

<script setup lang="ts">
import {
  useApplyPayeeTagsToExisting,
  useCreatePayeeAlias,
  useDeletePayee,
  useDeletePayeeAlias,
  useDeletePayeeAndIgnore,
  useMergePayees,
  usePayee,
  useUpdatePayee,
} from '@/composable/data-queries/payees';
import { useBaseCurrency } from '@/composable/data-queries/currencies';
import { useNotificationCenter } from '@/components/notification-center';
import { useCategoriesStore, useTagsStore } from '@/stores';
import { findFormattedCategoryById } from '@/stores/categories/helpers';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { API_ERROR_CODES, CATEGORIZATION_MODE, type PayeeNameConflictDetails } from '@bt/shared/types';
import { ApiErrorResponseError, getPayeeNameConflict, isApiErrorWithCode } from '@/js/errors';
import { ChevronLeftIcon, InfoIcon, PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';

import PayeeActionsDropdown from './components/payee-actions-dropdown.vue';
import PayeeDefaultLocationField from './components/payee-default-location-field.vue';
import PayeeFormDialog from './components/payee-form-dialog.vue';
import PayeeLogoPicker from './components/payee-logo-picker.vue';
import PayeeTransactionsDialog from './components/payee-transactions-dialog.vue';

defineOptions({ name: 'settings-payee-detail' });

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const payeeId = computed(() => String(route.params.id));

const { data: payeeData, refetch } = usePayee({ id: payeeId });

const { formattedCategories, categoriesMap } = storeToRefs(useCategoriesStore());

// TagSelectField renders pills from the tags store – make sure it's populated
// when the user lands on this page directly.
useTagsStore().loadTags();

const categoryName = (id: string | null) => (id ? (categoriesMap.value?.[id]?.name ?? '') : '');

const updateMut = useUpdatePayee();
const defaultCategoryProxy = computed({
  get: () =>
    payeeData.value?.defaultCategoryId
      ? findFormattedCategoryById(formattedCategories.value, payeeData.value.defaultCategoryId)
      : null,
  set: async (value) => {
    if (!payeeData.value) return;
    try {
      await updateMut.mutateAsync({
        id: payeeData.value.id,
        payload: { defaultCategoryId: value?.id ?? null },
      });
      addSuccessNotification(t('payees.toasts.updated'));
    } catch {
      addErrorNotification(t('payees.errors.generic'));
    }
  },
});

interface CategorizationModeOption {
  value: CATEGORIZATION_MODE;
  label: string;
  hint: string;
}

const categorizationModeOptions = computed<CategorizationModeOption[]>(() => [
  {
    value: CATEGORIZATION_MODE.enforce,
    label: t('payees.form.categorizationMode.enforce.label'),
    hint: t('payees.form.categorizationMode.enforce.hint'),
  },
  {
    value: CATEGORIZATION_MODE.hint,
    label: t('payees.form.categorizationMode.hint.label'),
    hint: t('payees.form.categorizationMode.hint.hint'),
  },
  {
    value: CATEGORIZATION_MODE.off,
    label: t('payees.form.categorizationMode.off.label'),
    hint: t('payees.form.categorizationMode.off.hint'),
  },
]);

const categorizationModeProxy = computed<CategorizationModeOption>({
  get: () => {
    const current = payeeData.value?.categorizationMode ?? CATEGORIZATION_MODE.enforce;
    return categorizationModeOptions.value.find((opt) => opt.value === current) ?? categorizationModeOptions.value[0]!;
  },
  set: async (value) => {
    if (!payeeData.value || value.value === payeeData.value.categorizationMode) return;
    try {
      await updateMut.mutateAsync({
        id: payeeData.value.id,
        payload: { categorizationMode: value.value },
      });
      addSuccessNotification(t('payees.toasts.updated'));
    } catch {
      addErrorNotification(t('payees.errors.generic'));
    }
  },
});

const defaultTagsProxy = computed<string[]>({
  get: () => payeeData.value?.defaultTagIds ?? [],
  set: async (value) => {
    if (!payeeData.value) return;
    try {
      await updateMut.mutateAsync({
        id: payeeData.value.id,
        payload: { defaultTagIds: value },
      });
      addSuccessNotification(t('payees.toasts.updated'));
    } catch (error) {
      // The backend rejects with a specific message (e.g. tag not owned by
      // the user) – surface it instead of the generic fallback. The query
      // invalidation snaps the field back to the saved set.
      if (error instanceof ApiErrorResponseError) {
        addErrorNotification(error.data.message ?? t('payees.errors.generic'));
        return;
      }
      captureException({ error, context: { flow: 'updatePayeeDefaultTags' } });
      addErrorNotification(t('payees.errors.generic'));
    }
  },
});

const canApplyTagsToExisting = computed(
  () => (payeeData.value?.defaultTagIds?.length ?? 0) > 0 && (payeeData.value?.stats?.transactionCount ?? 0) > 0,
);

const applyTagsMut = useApplyPayeeTagsToExisting();
async function handleApplyTagsToExisting() {
  if (!payeeData.value) return;
  try {
    const { updatedTransactionsCount } = await applyTagsMut.mutateAsync({ id: payeeData.value.id });
    addSuccessNotification(t('payees.toasts.tagsAppliedToExisting', { count: updatedTransactionsCount }));
  } catch (error) {
    if (error instanceof ApiErrorResponseError) {
      addErrorNotification(error.data.message ?? t('payees.errors.generic'));
      return;
    }
    captureException({ error, context: { flow: 'applyPayeeTagsToExisting' } });
    addErrorNotification(t('payees.errors.generic'));
  }
}

const NET_FLOW_FALLBACK_CURRENCY = 'USD';
const { data: baseCurrency } = useBaseCurrency();
const formatNetFlow = (val: number) =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: baseCurrency.value?.currencyCode ?? NET_FLOW_FALLBACK_CURRENCY,
    signDisplay: 'always',
    maximumFractionDigits: 0,
  }).format(val);

const netFlowToneClass = (val: number) => {
  if (val > 0) return 'text-app-income-color';
  if (val < 0) return 'text-app-expense-color';
  return '';
};

const logoPickerOpen = ref(false);

const renameOpen = ref(false);
const openRename = () => (renameOpen.value = true);

const mergeOpen = ref(false);
const mergeTargetId = ref<string | null>(null);
const openMerge = () => {
  mergeTargetId.value = null;
  mergeOpen.value = true;
};
const mergeMut = useMergePayees();
async function handleMerge() {
  if (!payeeData.value || !mergeTargetId.value) return;
  try {
    await mergeMut.mutateAsync({
      sourceId: payeeData.value.id,
      targetPayeeId: mergeTargetId.value,
    });
    addSuccessNotification(t('payees.toasts.merged'));
    router.push({ name: ROUTES_NAMES.settingsPayees });
  } catch {
    addErrorNotification(t('payees.errors.generic'));
  }
}

const deleteOpen = ref(false);
const openDelete = () => (deleteOpen.value = true);
const deleteMut = useDeletePayee();
async function handleDelete() {
  if (!payeeData.value) return;
  try {
    await deleteMut.mutateAsync({ id: payeeData.value.id });
    addSuccessNotification(t('payees.toasts.deleted'));
    router.push({ name: ROUTES_NAMES.settingsPayees });
  } catch {
    addErrorNotification(t('payees.errors.generic'));
  }
}

const deleteAndIgnoreOpen = ref(false);
const openDeleteAndIgnore = () => (deleteAndIgnoreOpen.value = true);

const transactionsDialogOpen = ref(false);
const openTransactionsDialog = (event?: MouseEvent) => {
  // The mobile drawer sets `aria-hidden` on `#app` once it opens. If this
  // trigger still owns focus, that hides a focused descendant from AT and the
  // browser warns. Blur first so the drawer's focus trap takes over cleanly.
  if (event?.currentTarget instanceof HTMLElement) {
    event.currentTarget.blur();
  }
  if (payeeData.value?.stats && payeeData.value.stats.transactionCount > 0) {
    transactionsDialogOpen.value = true;
  }
};
const deleteAndIgnoreMut = useDeletePayeeAndIgnore();
async function handleDeleteAndIgnore() {
  if (!payeeData.value) return;
  try {
    await deleteAndIgnoreMut.mutateAsync({ id: payeeData.value.id });
    addSuccessNotification(t('payees.toasts.deletedAndIgnored'));
    router.push({ name: ROUTES_NAMES.settingsPayees });
  } catch {
    addErrorNotification(t('payees.errors.generic'));
  }
}

interface AliasError {
  message?: string;
  conflictingPayee?: PayeeNameConflictDetails['conflictingPayee'];
}

const addAliasOpen = ref(false);
const aliasInput = ref('');
const aliasError = ref<AliasError | null>(null);
const openAddAlias = () => {
  aliasInput.value = '';
  aliasError.value = null;
  addAliasOpen.value = true;
};

const createAliasMut = useCreatePayeeAlias();
async function handleAddAlias() {
  if (!payeeData.value) return;
  const rawName = aliasInput.value.trim();
  if (!rawName || createAliasMut.isPending.value) return;
  aliasError.value = null;
  try {
    await createAliasMut.mutateAsync({ payeeId: payeeData.value.id, rawName });
    addSuccessNotification(t('payees.toasts.aliasAdded'));
    addAliasOpen.value = false;
  } catch (error) {
    // Cross-payee collisions carry the other Payee in `details` so the UI
    // can render a link instead of a name string. Same-payee duplicates
    // don't include `details` – fall back to the message the server sent.
    const conflicting = getPayeeNameConflict(error);
    if (conflicting) {
      aliasError.value = { conflictingPayee: conflicting };
      return;
    }
    if (isApiErrorWithCode(error, API_ERROR_CODES.conflict)) {
      aliasError.value = { message: error.data.message ?? t('payees.detail.aliasDuplicate') };
      return;
    }
    if (error instanceof ApiErrorResponseError) {
      aliasError.value = { message: error.data.message ?? t('payees.errors.generic') };
      return;
    }
    // Non-API failure (network layer, client-side bug) – report it so the
    // generic toast isn't the only trace.
    captureException({ error, context: { flow: 'createPayeeAlias' } });
    addErrorNotification(t('payees.errors.generic'));
  }
}

const deleteAliasMut = useDeletePayeeAlias();
async function confirmDeleteAlias(aliasId: string) {
  if (!payeeData.value) return;
  try {
    await deleteAliasMut.mutateAsync({ payeeId: payeeData.value.id, aliasId });
    addSuccessNotification(t('payees.toasts.aliasDeleted'));
  } catch (error) {
    // The button is disabled for the canonical-name alias under normal
    // conditions, but the backend validation still fires on race or stale UI
    // state. Surface the specific reason instead of a generic message.
    if (isApiErrorWithCode(error, API_ERROR_CODES.validationError)) {
      addErrorNotification(t('payees.detail.cannotDeleteCanonicalAlias'));
    } else {
      addErrorNotification(t('payees.errors.generic'));
    }
  }
}
</script>
