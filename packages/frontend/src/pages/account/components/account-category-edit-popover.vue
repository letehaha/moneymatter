<script setup lang="ts">
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_CATEGORIES, AccountModel, isDedicatedFlowAccountCategory } from '@bt/shared/types';
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

type CategoryOption = { value: ACCOUNT_CATEGORIES; label: string };

// Loan and vehicle own sidecar rows managed by dedicated flows, so the generic
// update endpoint rejects moving accounts into them.
const categoryOptions = computed<CategoryOption[]>(() =>
  Object.values(ACCOUNT_CATEGORIES)
    .filter((category) => !isDedicatedFlowAccountCategory(category))
    .map((category) => ({ value: category, label: t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[category]) })),
);

const selected = ref<CategoryOption | null>(null);

const updateCategory = async () => {
  if (!selected.value || selected.value.value === props.account.accountCategory) return;

  isSaving.value = true;
  try {
    await accountsStore.editAccount({
      id: props.account.id,
      accountCategory: selected.value.value,
    });
    isOpen.value = false;
    addSuccessNotification(t('pages.account.details.accountCategoryUpdateSuccess'));
  } catch {
    addErrorNotification(t('pages.account.details.accountCategoryUpdateError'));
  } finally {
    isSaving.value = false;
  }
};

watch([isOpen, () => props.account.id], () => {
  selected.value = categoryOptions.value.find((option) => option.value === props.account.accountCategory) ?? null;
});
</script>

<template>
  <DesktopOnlyTooltip :content="$t('pages.account.details.editAccountCategory')" :disabled="isOpen">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm">
          <PencilIcon class="size-3.5" />
        </Button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent>
        <form class="grid gap-4" @submit.prevent="updateCategory">
          <SelectField
            v-model="selected"
            :values="categoryOptions"
            :label="$t('pages.account.details.accountCategory')"
          />
          <Button
            type="submit"
            :disabled="!selected || selected.value === account.accountCategory || isSaving"
            :loading="isSaving"
          >
            {{ $t('pages.account.details.save') }}
          </Button>
        </form>
      </Popover.PopoverContent>
    </Popover.Popover>
  </DesktopOnlyTooltip>
</template>
