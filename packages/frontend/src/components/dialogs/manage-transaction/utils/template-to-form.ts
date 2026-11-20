import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type CurrencyModel,
  TRANSACTION_TYPES,
  type TransactionTemplateModel,
} from '@bt/shared/types';

import { FORM_TYPES, type UI_FORM_STRUCT } from '../types';

/** References a template pins that no longer resolve against the current picker lists. */
export type TemplateMissingRef = 'category' | 'account';

export interface TemplateFormSources {
  /** The account picker's own list: writable, active, system accounts. */
  sourceAccounts: AccountModel[];
  categoriesMap: Record<string, FormattedCategory>;
  knownTagIds: ReadonlySet<string>;
  currencies: CurrencyModel[];
}

/**
 * The backend accepts a pinned account only when it is the caller's own active system
 * account; anything else comes back as a 404 on save.
 */
export const isPinnableTemplateAccount = ({ account }: { account: AccountModel }): boolean =>
  account.type === ACCOUNT_TYPES.system &&
  account.status === ACCOUNT_STATUSES.active &&
  (!account.share || account.share.isOwner === true);

// The out-of-wallet placeholder carries a null id. Connected, archived and shared accounts
// cannot host a template, so they are dropped as well.
const asRealAccount = (account: AccountModel | null | undefined): AccountModel | null =>
  account && account.id !== OUT_OF_WALLET_ACCOUNT_MOCK.id && isPinnableTemplateAccount({ account }) ? account : null;

/** Only a reference the template pins and can no longer resolve counts as missing. */
export const resolveMissingRefs = ({
  template,
  sources,
}: {
  template: TransactionTemplateModel;
  sources: TemplateFormSources;
}): TemplateMissingRef[] => {
  const missing: TemplateMissingRef[] = [];
  if (template.accountId && !sources.sourceAccounts.some((account) => account.id === template.accountId)) {
    missing.push('account');
  }
  if (template.categoryId && !sources.categoriesMap[template.categoryId]) missing.push('category');
  return missing;
};

export const templateToForm = ({
  template,
  current,
  sources,
}: {
  template: TransactionTemplateModel;
  current: UI_FORM_STRUCT;
  sources: TemplateFormSources;
}): { form: UI_FORM_STRUCT; missing: TemplateMissingRef[] } => {
  const pinnedAccount = template.accountId
    ? (sources.sourceAccounts.find((account) => account.id === template.accountId) ?? null)
    : null;

  const category = template.categoryId ? (sources.categoriesMap[template.categoryId] ?? null) : null;

  const paymentType = template.paymentType
    ? (VERBOSE_PAYMENT_TYPES.find((item) => item.value === template.paymentType) ?? current.paymentType)
    : current.paymentType;

  return {
    form: {
      type: template.transactionType === TRANSACTION_TYPES.income ? FORM_TYPES.income : FORM_TYPES.expense,
      account: pinnedAccount ?? asRealAccount(current.account),
      // The amount travels with the pinned account: it needs that account's currency.
      amount: pinnedAccount ? template.amount : null,
      category,
      categoryUserTouched: category !== null,
      payeeId: template.payeeId ?? null,
      tagIds: template.tagIds.filter((id) => sources.knownTagIds.has(id)),
      paymentType,
      paymentTypeUserTouched: Boolean(template.paymentType) || Boolean(current.paymentTypeUserTouched),
      note: template.note ?? undefined,
      time: new Date(),
      isPlanned: current.isPlanned,
      toAccount: null,
      toPortfolio: null,
      targetAmount: null,
      splits: [],
      refundsTx: undefined,
      refundedByTxs: undefined,
      originalAmount: null,
      originalCurrency: sources.currencies.find((item) => item.code === template.originalCurrencyCode) ?? null,
    },
    missing: resolveMissingRefs({ template, sources }),
  };
};
