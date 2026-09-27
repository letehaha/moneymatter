<template>
  <DefineBody>
    <p v-if="mode !== 'edit'" class="text-sm leading-relaxed">
      {{
        mode === 'bank'
          ? $t('transactions.inlineEdit.bankDescription')
          : $t('transactions.inlineEdit.managedDescription')
      }}
    </p>
    <DateField v-else-if="column === TABLE_COLUMN.date" ref="dropdownFieldRef" v-model="form.date" />
    <AccountSelectField
      v-else-if="column === TABLE_COLUMN.account"
      ref="dropdownFieldRef"
      v-model="form.account"
      :accounts="accountOptions"
      :placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
    />
    <template v-else-if="column === TABLE_COLUMN.category">
      <p v-if="categoriesStatus === 'error'" class="text-destructive-text text-sm">
        {{ $t('fields.categorySelect.sharedOwnerCategoriesLoadError') }}
      </p>
      <div v-else-if="categoriesStatus === 'pending'" class="bg-muted/30 h-10 animate-pulse rounded-md md:h-9" />
      <CategorySelectField
        v-else
        ref="dropdownFieldRef"
        v-model="form.category"
        :values="categories"
        :categories-map="isSharedWithCaller ? sharedCategories.map.value : undefined"
        :shared-owner-username="ownerHandle ?? undefined"
        :placeholder="$t('dialogs.manageTransaction.form.selectCategoryPlaceholder')"
        label-key="name"
      />
    </template>
    <PayeeSelectField
      v-else-if="column === TABLE_COLUMN.payee"
      ref="dropdownFieldRef"
      v-model="form.payeeId"
      :account-id="tx.accountId"
      :owner-scoped="isSharedWithCaller"
    />
    <div v-else-if="column === TABLE_COLUMN.amount" class="relative">
      <FormattedAmountField
        v-model="form.amount"
        :placeholder="$t('dialogs.manageTransaction.form.amountPlaceholder')"
      />
      <div v-if="isMobile && form.amount !== null" class="absolute top-0 right-1 flex h-10 items-center md:h-9">
        <ClearButton />
      </div>
    </div>
    <InputField
      v-else-if="column === TABLE_COLUMN.note"
      v-model="form.note"
      :maxlength="MAX_NOTE_LENGTH"
      :placeholder="$t('dialogs.manageTransaction.form.notePlaceholder')"
      trailing-icon-css-class="px-1"
    >
      <template v-if="isMobile && form.note" #iconTrailing>
        <ClearButton />
      </template>
    </InputField>
    <TagSelectField
      v-else-if="column === TABLE_COLUMN.tags"
      ref="dropdownFieldRef"
      v-model="form.tagIds"
      :error-message="
        form.tagIds.length > MAX_TAGS ? $t('transactions.inlineEdit.tooManyTags', { max: MAX_TAGS }) : undefined
      "
    />
  </DefineBody>

  <!-- mousedown.prevent keeps focus (and the phone keyboard) in the input being cleared. -->
  <DefineClearButton>
    <DesktopOnlyTooltip :content="$t('common.actions.clear')">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('common.actions.clear')"
        @mousedown.prevent
        @click="clearText"
      >
        <XIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>
  </DefineClearButton>

  <DefineFooter>
    <template v-if="mode === 'edit'">
      <Button :variant="isMobile ? 'secondary' : 'ghost'" size="sm" @click="emit('close')">{{
        $t('common.actions.cancel')
      }}</Button>
      <Button size="sm" :disabled="!canSave" @click="save">
        {{ $t('common.actions.save') }}
        <kbd class="touch:hidden text-xs opacity-70">↵</kbd>
      </Button>
    </template>
    <template v-else>
      <Button :variant="isMobile ? 'secondary' : 'ghost'" size="sm" @click="emit('close')">{{
        $t('transactions.inlineEdit.gotIt')
      }}</Button>
      <Button size="sm" @click="emit('open-details')">{{ $t('transactions.inlineEdit.openDetails') }}</Button>
    </template>
  </DefineFooter>

  <ResponsiveDialog
    v-if="isMobile"
    open
    @update:open="(open) => !open && emit('close')"
    @open-auto-focus="onOpenAutoFocus"
  >
    <template #title>{{ title }}</template>
    <Body />
    <template #footer>
      <div class="grid grid-cols-2 gap-2"><Footer /></div>
    </template>
  </ResponsiveDialog>

  <Popover v-else open @update:open="(open: boolean) => !open && emit('close')">
    <PopoverAnchor :reference="anchor" />
    <!-- No entry animation: the field's list opens at once and sizes itself from a trigger a zoom-in would still be scaling. -->
    <PopoverContent
      align="start"
      class="w-72 animate-none! p-0"
      @keydown.capture="onKeydown"
      @open-auto-focus="onOpenAutoFocus"
      @pointer-down-outside="onPointerDownOutside"
    >
      <p class="text-muted-foreground border-b px-3 py-2 text-xs font-medium tracking-wider uppercase">
        {{ title }}
      </p>
      <div class="p-3"><Body /></div>
      <div data-editor-footer class="flex justify-end gap-2 border-t px-3 py-2">
        <Footer />
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent } from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useAccountCategories } from '@/composable/data-queries/categories';
import { useAccountAccess } from '@/composable/use-account-access';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { useAccountsStore, useCategoriesStore } from '@/stores';
import { findFormattedCategoryById } from '@/stores/categories/helpers';
import type { TransactionModel } from '@bt/shared/types';
import type { UpdateTransactionBody } from '@bt/shared/types/endpoints';
import { createReusableTemplate } from '@vueuse/core';
import { XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { PopoverAnchor, type PointerDownOutsideEvent, type ReferenceElement } from 'reka-ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { TABLE_COLUMN } from './columns';
import type { ClaimedCellMode, InlineEditableColumn } from './inline-cell-mode';
import { MAX_TAGS, buildInlineEditBody, canSaveInlineEdit } from './inline-edit-payload';
import { inlineCellKey } from './use-inline-transaction-edit';

const MAX_NOTE_LENGTH = 1000;

const props = defineProps<{
  tx: TransactionModel;
  column: InlineEditableColumn;
  label: string;
  mode: ClaimedCellMode;
  anchor: ReferenceElement;
}>();

const emit = defineEmits<{
  close: [];
  save: [body: UpdateTransactionBody];
  'open-details': [];
}>();

const [DefineBody, Body] = createReusableTemplate();
const [DefineFooter, Footer] = createReusableTemplate();
const [DefineClearButton, ClearButton] = createReusableTemplate();

const { t } = useI18n();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);
const { accountsRecord, txTargetableSourceAccountsActiveFirst, plannedTargetableAccountsActiveFirst } =
  storeToRefs(useAccountsStore());
const { formattedCategories } = storeToRefs(useCategoriesStore());

const { isSharedWithCaller, ownerHandle } = useAccountAccess(() => accountsRecord.value[props.tx.accountId]);
// Categories and payees on a shared account are validated against the owner's, not the caller's.
const sharedCategories = useAccountCategories({
  accountId: () => props.tx.accountId,
  enabled: () => isSharedWithCaller.value && props.column === TABLE_COLUMN.category,
});
const categories = computed(() =>
  isSharedWithCaller.value ? sharedCategories.formatted.value : formattedCategories.value,
);
// Gated on data, not status: a failed background refetch keeps cached data but flips status to error.
const categoriesStatus = computed(() =>
  !isSharedWithCaller.value || sharedCategories.data.value ? 'success' : sharedCategories.status.value,
);

const accountOptions = computed(() =>
  props.tx.isPlanned ? plannedTargetableAccountsActiveFirst.value : txTargetableSourceAccountsActiveFirst.value,
);

const title = computed(() => {
  if (props.mode === 'bank') return t('transactions.inlineEdit.bankTitle');
  if (props.mode === 'managed') return t('transactions.inlineEdit.managedTitle');
  return props.label;
});

const form = reactive({
  date: new Date(props.tx.time),
  account: accountsRecord.value[props.tx.accountId] ?? null,
  category: findFormattedCategoryById(categories.value, props.tx.categoryId),
  payeeId: props.tx.payeeId ?? null,
  amount: props.tx.amount as number | null,
  note: props.tx.note ?? '',
  tagIds: (props.tx.tags ?? []).map((tag) => tag.id),
});

// Owner categories on a shared account arrive after mount.
watch(categories, (list) => {
  if (!form.category) form.category = findFormattedCategoryById(list, props.tx.categoryId);
});

const body = computed(() => buildInlineEditBody({ column: props.column, form }));
const canSave = computed(() => canSaveInlineEdit({ tx: props.tx, body: body.value }));

const clearText = () => {
  if (props.column === TABLE_COLUMN.amount) form.amount = null;
  else form.note = '';
};

const dropdownFieldRef = ref<{ open: () => void } | null>(null);

// Opening the field's list replaces the popover's or drawer's own auto-focus, whose focus move would dismiss the list.
const onOpenAutoFocus = (event: Event) => {
  if (!dropdownFieldRef.value) return;
  event.preventDefault();
  dropdownFieldRef.value.open();
};

// Owner categories that load after the editor opened mount the field late.
watch(categoriesStatus, (status) => status === 'success' && dropdownFieldRef.value?.open(), { flush: 'post' });

// The table toggles the editor on its own cell's click; dismissing here as well would reopen it.
const onPointerDownOutside = (event: PointerDownOutsideEvent) => {
  const cellKey = inlineCellKey({ txId: props.tx.id, column: props.column });
  if ((event.detail.originalEvent.target as Element | null)?.closest(`[data-inline-cell="${cellKey}"]`)) {
    event.preventDefault();
  }
};

const save = () => {
  if (canSave.value) emit('save', body.value!);
};

// Capture phase: field triggers act on Enter keydown before it could bubble here.
// While nothing changed, Enter still reaches the field and reopens its list.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.isComposing || !canSave.value) return;
  if ((event.target as HTMLElement).closest('[data-editor-footer], [role="button"], [data-enter-picks]')) return;
  event.preventDefault();
  event.stopPropagation();
  save();
};
</script>
