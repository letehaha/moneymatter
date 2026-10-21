import { getAllCurrencies, loadUserBaseCurrency, loadUserCurrencies } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { registerCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { invalidatePersistedQuery, queryClient } from '@/lib/query-client';
import { CurrencyModel, UserCurrencyModel } from '@bt/shared/types';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useCurrenciesStore = defineStore('currencies', () => {
  const systemCurrencies = ref<CurrencyModel[]>([]);
  const currencies = ref<UserCurrencyModel[]>([]);
  const baseCurrency = ref<UserCurrencyModel | null>(null);
  const isBaseCurrencyExists = computed(() => Boolean(baseCurrency.value));

  const splitByLinked = ({ list }: { list: CurrencyModel[] }) =>
    list.reduce(
      (acc, curr) => {
        if (currencies.value.find((item) => item.currencyCode === curr.code)) {
          acc.linked.push(curr);
        } else {
          acc.unlinked.push(curr);
        }
        return acc;
      },
      { linked: [] as CurrencyModel[], unlinked: [] as CurrencyModel[] },
    );

  // `systemCurrencies` is what every picker lists: the ISO catalogue plus the user's own
  // custom currencies (the public catalogue never carries those).
  const systemCurrenciesVerbose = computed(() => splitByLinked({ list: systemCurrencies.value }));

  // Contexts that accept ISO codes only (loans, vehicles, investments, bank integrations)
  // must not offer a custom currency the backend would reject.
  const isoCurrencies = computed(() => systemCurrencies.value.filter((item) => !item.isCustom));
  const isoCurrenciesVerbose = computed(() => splitByLinked({ list: isoCurrencies.value }));

  const currenciesMap = computed(() =>
    currencies.value.reduce(
      (acc, curr) => {
        acc[curr.currencyCode] = curr;
        return acc;
      },
      {} as Record<string, UserCurrencyModel>,
    ),
  );

  // Every currency picker reads `systemCurrencies`, so the user's own currencies lead it.
  // ponytail: linked-first, not usage-ranked; rank by transaction counts if the linked set grows long.
  const orderLinkedFirst = () => {
    const linkedCodes = new Set(currencies.value.map((item) => item.currencyCode));
    systemCurrencies.value = [...systemCurrencies.value].sort(
      (a, b) => Number(linkedCodes.has(b.code)) - Number(linkedCodes.has(a.code)),
    );
  };

  // Formatters and amount inputs outside the store resolve decimals by code, so every
  // list the store receives is registered with the registry they read.
  const registerDecimals = ({ items }: { items: Array<CurrencyModel | undefined> }) =>
    registerCurrencyDecimals({
      entries: items.flatMap((item) =>
        item ? [{ code: item.code, decimals: item.digits, isCustom: item.isCustom, symbol: item.symbol }] : [],
      ),
    });

  // Both fetches run through the vue-query cache (staleTime Infinity) so they dedupe on
  // init and can be persisted/invalidated by key. `force` drops the cached entries first,
  // so post-mutation reloads pull fresh data instead of returning the cache.
  //
  // `fetchQuery`, not `ensureQueryData` – the latter short-circuits on present data
  // and would hand back the entry `force` just invalidated, making the flag inert.
  const loadCurrencies = async ({ force = false }: { force?: boolean } = {}) => {
    if (force) {
      await Promise.all([
        invalidatePersistedQuery({ queryKey: VUE_QUERY_CACHE_KEYS.userCurrencies }),
        invalidatePersistedQuery({ queryKey: VUE_QUERY_CACHE_KEYS.allCurrencies }),
      ]);
    }

    const [userCurrencies, systemOnes] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: VUE_QUERY_CACHE_KEYS.userCurrencies,
        queryFn: loadUserCurrencies,
        staleTime: Infinity,
      }),
      queryClient.fetchQuery({
        queryKey: VUE_QUERY_CACHE_KEYS.allCurrencies,
        queryFn: getAllCurrencies,
        staleTime: Infinity,
      }),
    ]);

    currencies.value = userCurrencies;
    systemCurrencies.value = [
      ...systemOnes,
      ...userCurrencies.flatMap((item) => (item.currency?.isCustom ? [item.currency] : [])),
    ];
    registerDecimals({ items: [...systemOnes, ...userCurrencies.map((item) => item.currency)] });
    orderLinkedFirst();
  };

  const getCurrency = (currencyCode: string) =>
    currencies.value.find((currency) => currency.currencyCode === currencyCode);

  const loadBaseCurrency = async ({ force = false }: { force?: boolean } = {}) => {
    if (force) {
      await invalidatePersistedQuery({ queryKey: VUE_QUERY_CACHE_KEYS.baseCurrency });
    }

    const result = await queryClient.fetchQuery({
      queryKey: VUE_QUERY_CACHE_KEYS.baseCurrency,
      queryFn: loadUserBaseCurrency,
      staleTime: Infinity,
    });

    if (result) {
      baseCurrency.value = result;
      registerDecimals({ items: [result.currency] });

      if (!currencies.value.find((item) => item.id === result.id)) {
        currencies.value.push(result);
        orderLinkedFirst();
      }
    }
  };

  return {
    currencies,
    baseCurrency,
    systemCurrencies,
    currenciesMap,
    systemCurrenciesVerbose,
    isoCurrencies,
    isoCurrenciesVerbose,
    isBaseCurrencyExists,
    loadCurrencies,
    loadBaseCurrency,
    getCurrency,
  };
});
