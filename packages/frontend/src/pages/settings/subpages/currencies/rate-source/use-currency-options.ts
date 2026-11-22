import { useCurrencyName } from '@/composable/formatters';
import { useCurrenciesStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

interface CurrencyOption {
  value: string;
  label: string;
}

/**
 * Options for the currency pickers of the rate-source editor. Every rate of a custom currency is
 * quoted in an ISO currency: a peg targets one the user holds, a synced source quotes in any.
 */
export const useCurrencyOptions = () => {
  const currenciesStore = useCurrenciesStore();
  const { currencies, isoCurrencies } = storeToRefs(currenciesStore);
  const { getCurrencyName } = useCurrencyName();

  const toOption = ({ code, name }: { code: string; name?: string }): CurrencyOption => ({
    value: code,
    label: `${code} · ${getCurrencyName({ code, fallbackName: name })}`,
  });

  const pegOptions = computed(() =>
    currencies.value
      .filter((item) => !item.currency?.isCustom)
      .map((item) => toOption({ code: item.currencyCode, name: item.currency?.currency })),
  );

  const isoOptions = computed(() =>
    isoCurrencies.value.map((item) => toOption({ code: item.code, name: item.currency })),
  );

  return { pegOptions, isoOptions };
};

export const findOption = ({ options, value }: { options: CurrencyOption[]; value: string | null }) =>
  options.find((option) => option.value === value) ?? (value ? { value, label: value } : null);
