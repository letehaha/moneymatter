import type { FormattedCategory } from '@/common/types';
import { usePayeesByIds } from '@/composable/data-queries/payees';
import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useCurrenciesStore } from '@/stores/currencies';
import { useTagsStore } from '@/stores/tags';
import { type AccountModel, type ChatEntityKind, type ChatProposalCard, chatEntityRefKey } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

import { fieldEntityKind, isProposalRef } from './card-values';

/** What a card needs from the rest of the app to name the records it mentions and to offer pickers. */
export interface CardLookups {
  /** The display name of a record the app already holds; `null` when it is not known. */
  entityName: (params: { kind: ChatEntityKind; id: string }) => string | null;
  accountCurrency: (params: { id: string }) => string | null;
  baseCurrencyCode: () => string | null;
  accounts: () => AccountModel[];
  categories: () => FormattedCategory[];
  currencyCodes: () => string[];
}

const idsOf = ({ value }: { value: unknown }): string[] => {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string' && !isProposalRef({ value: item }));
};

/**
 * Names the records of a card from the stores the app keeps. Accounts, categories, tags and
 * currencies are in memory already; payees are read one at a time, only the ones the card mentions.
 * A record the app has no list of (a subscription, a transaction, a budget) is named by the server, which
 * sends the names with the card; one that has no name in either place shows its kind.
 */
export const useCardLookups = ({ card }: { card: MaybeRefOrGetter<ChatProposalCard> }): CardLookups => {
  const { accountsRecord, systemAccounts } = storeToRefs(useAccountsStore());
  const { categoriesMap, formattedCategories } = storeToRefs(useCategoriesStore());
  const { tagsMap } = storeToRefs(useTagsStore());
  const { baseCurrency, currencies } = storeToRefs(useCurrenciesStore());

  // The target record of a delete or update card is named too: its payee is not one of the card's arguments.
  const payeeIds = computed(() => [
    ...new Set(
      [...toValue(card).fields, ...(toValue(card).target ?? [])].flatMap((field) =>
        fieldEntityKind({ field }) === 'payee'
          ? [...idsOf({ value: field.value }), ...idsOf({ value: field.uncertain?.alternatives ?? [] })]
          : [],
      ),
    ),
  ]);
  const { byId: payees } = usePayeesByIds({ ids: payeeIds });

  const entityName: CardLookups['entityName'] = ({ kind, id }) => {
    switch (kind) {
      case 'account':
        return accountsRecord.value[id]?.name ?? null;
      case 'category':
        return categoriesMap.value[id]?.name ?? null;
      case 'tag':
        return tagsMap.value[id]?.name ?? null;
      case 'payee':
        return payees.value.get(id)?.name ?? null;
      case 'userCurrency':
      case 'customCurrency':
        return id;
      default:
        return toValue(card).labels?.[chatEntityRefKey({ kind, id })] ?? null;
    }
  };

  return {
    entityName,
    accountCurrency: ({ id }) => accountsRecord.value[id]?.currencyCode ?? null,
    baseCurrencyCode: () => baseCurrency.value?.currencyCode ?? null,
    accounts: () => systemAccounts.value,
    categories: () => formattedCategories.value,
    currencyCodes: () => currencies.value.map((currency) => currency.currencyCode),
  };
};
