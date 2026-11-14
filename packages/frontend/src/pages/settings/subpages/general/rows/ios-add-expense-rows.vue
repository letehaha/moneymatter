<template>
  <div class="flex flex-col gap-3">
    <div>
      <div class="text-sm font-medium">{{ $t('settings.general.iosAddExpense.label') }}</div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ $t('settings.general.iosAddExpense.description') }}
      </p>
    </div>

    <div class="divide-y rounded-md border">
      <SettingRow
        class="px-4 py-3"
        :label="$t('settings.general.iosAddExpense.showBankAccounts.label')"
        :description="$t('settings.general.iosAddExpense.showBankAccounts.description')"
      >
        <Switch
          :model-value="showBankAccounts"
          :disabled="isPatching || !userSettings"
          @update:model-value="handleShowBankAccountsToggle"
        />
      </SettingRow>

      <SettingRow
        class="px-4 py-3"
        :label="$t('settings.general.iosAddExpense.hiddenCategories.label')"
        :description="$t('settings.general.iosAddExpense.hiddenCategories.description')"
      >
        <div class="w-64 shrink-0">
          <CategoryMultiSelectField
            :model-value="excludedCategoryIds"
            cover-subtree
            :placeholder="$t('settings.general.iosAddExpense.hiddenCategories.placeholder')"
            :disabled="isPatching || !userSettings"
            @update:model-value="handleExcludedCategoriesChange"
          />
        </div>
      </SettingRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IosAddExpenseSettings } from '@/api/user-settings';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: userSettings, patchAsync, isPatching } = useUserSettings();

const showBankAccounts = computed(() => !!userSettings.value?.ios?.addExpense?.showBankAccounts);
const excludedCategoryIds = computed(() => userSettings.value?.ios?.addExpense?.excludedCategoryIds ?? []);

const patchAddExpense = async ({ addExpense }: { addExpense: IosAddExpenseSettings }) => {
  try {
    await patchAsync({ ios: { addExpense } });
    addSuccessNotification(t('settings.general.iosAddExpense.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.iosAddExpense.errorNotification'));
  }
};

const handleShowBankAccountsToggle = (value: boolean) => patchAddExpense({ addExpense: { showBankAccounts: value } });

const handleExcludedCategoriesChange = (ids: string[]) => patchAddExpense({ addExpense: { excludedCategoryIds: ids } });
</script>
