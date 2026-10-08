<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button type="button" size="sm">
        <PlusIcon class="size-4" />
        {{ $t('settings.currencies.addNew.sectionLabel') }}
      </Button>
    </PopoverTrigger>

    <PopoverContent class="w-80" align="end">
      <div class="flex flex-col gap-3">
        <SelectField
          v-model="selectedCurrency"
          :values="filteredCurrencies"
          :placeholder="
            isSubmitting ? $t('settings.currencies.addNew.loading') : $t('settings.currencies.addNew.selectCurrency')
          "
          value-key="code"
          with-search
          :disabled="!filteredCurrencies.length"
          :label-key="(item: CurrencyModel) => formatCurrencyLabel({ code: item.code, fallbackName: item.currency })"
        />

        <Button :disabled="!selectedCurrency || isSubmitting" :loading="isSubmitting" @click="addCurrency">
          <PlusIcon class="size-4" />
          {{ $t('settings.currencies.addNew.addButton') }}
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { addUserCurrencies } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { useCurrenciesStore } from '@/stores';
import { CurrencyModel } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { PlusIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const currenciesStore = useCurrenciesStore();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { currencies: userCurrencies, systemCurrencies } = storeToRefs(currenciesStore);
const queryClient = useQueryClient();
const { t } = useI18n();
const { formatCurrencyLabel } = useCurrencyName();

const isOpen = ref(false);
const selectedCurrency = ref<CurrencyModel | null>(null);
const filteredCurrencies = computed(() =>
  systemCurrencies.value.filter((item) => !userCurrencies.value.some((el) => el.currency?.code === item.code)),
);

const { mutate: addSelectedCurrency, isPending: isSubmitting } = useMutation({
  mutationFn: () => addUserCurrencies([{ currencyCode: selectedCurrency.value!.code }]),
  onSuccess: async () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates });
    await currenciesStore.loadCurrencies({ force: true });

    addSuccessNotification(t('settings.currencies.addNew.successfullyAdded'));
    selectedCurrency.value = null;
    isOpen.value = false;
  },
  onError: () => {
    addErrorNotification(t('settings.currencies.addNew.errors.addFailed'));
  },
});

const addCurrency = () => {
  if (!selectedCurrency.value) return;
  addSelectedCurrency();
};
</script>
