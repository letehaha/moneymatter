import { useAccountGroupPaths } from '@/composable/data-queries/account-groups';
import { useBankConnectionsQuery } from '@/composable/data-queries/bank-connections';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useAccountsStore, useCategoriesStore, useTagsStore } from '@/stores';
import type { AccountModel, AutomationRefType, PayeeLookupItem, RecordId, TagModel } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { type InjectionKey, computed, inject, provide } from 'vue';

/** Everything a chip needs to render a referenced row: its name plus whatever drives its avatar. */
type AutomationRefVisual = { name: string } & (
  | {
      type: 'account';
      account: Pick<
        AccountModel,
        'name' | 'logoDomain' | 'logoInitials' | 'logoColor' | 'logoIcon' | 'logoImageId' | 'accountCategory'
      >;
    }
  | { type: 'payee'; payee: PayeeLookupItem }
  | { type: 'category'; categoryId: RecordId }
  | { type: 'tag'; tag: TagModel }
  | { type: 'accountGroup' }
  | { type: 'bankConnection'; connectionId: RecordId }
);

/** Resolves the ids stored inside a rule's JSONB to display names; `undefined` means the row is gone. */
const useAutomationRefs = () => {
  const { categoriesMap, isFetched: isCategoriesFetched } = storeToRefs(useCategoriesStore());
  const { tagsMap, isFetched: isTagsFetched } = storeToRefs(useTagsStore());
  const { accountsRecord, isAccountsFetched } = storeToRefs(useAccountsStore());
  const { byId: payeeById, isSuccess: isPayeesLoaded } = usePayeeLookup();
  const { pathById: accountGroupPaths, isSuccess: isGroupsLoaded } = useAccountGroupPaths();
  const { data: bankConnections, isSuccess: isConnectionsLoaded } = useBankConnectionsQuery();

  const refVisual = ({ type, id }: { type: AutomationRefType; id: RecordId }): AutomationRefVisual | undefined => {
    switch (type) {
      case 'category': {
        const category = categoriesMap.value[id];
        return category && { type, name: category.name, categoryId: id };
      }
      case 'tag': {
        const tag = tagsMap.value[id];
        return tag && { type, name: tag.name, tag };
      }
      case 'account': {
        const account = accountsRecord.value[id];
        return account && { type, name: account.name, account };
      }
      case 'payee': {
        const payee = payeeById.value.get(id);
        return payee && { type, name: payee.name, payee };
      }
      case 'accountGroup': {
        const name = accountGroupPaths.value.get(id);
        return name === undefined ? undefined : { type, name };
      }
      case 'bankConnection': {
        const connection = bankConnections.value?.find((item) => item.id === id);
        return connection && { type, name: connection.bankName || connection.providerName, connectionId: id };
      }
    }
  };

  /**
   * Missing-reference highlighting must wait for every source to succeed, or a cold editor
   * flags every id and a failed fetch permanently blocks Save.
   */
  const isReady = computed(
    () =>
      isCategoriesFetched.value &&
      isTagsFetched.value &&
      isAccountsFetched.value &&
      isPayeesLoaded.value &&
      isGroupsLoaded.value &&
      isConnectionsLoaded.value,
  );

  return { refVisual, isReady };
};

type AutomationRefs = ReturnType<typeof useAutomationRefs>;

const AUTOMATION_REFS_KEY: InjectionKey<AutomationRefs> = Symbol('automation-refs');

/** Hoists the ref lookups to a list-level owner so every chip shares one set of queries. */
export const provideAutomationRefs = () => {
  const refs = useAutomationRefs();
  provide(AUTOMATION_REFS_KEY, refs);
  return refs;
};

export const injectAutomationRefs = () => inject(AUTOMATION_REFS_KEY, useAutomationRefs, true);
