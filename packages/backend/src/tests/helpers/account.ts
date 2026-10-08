import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountApiResponse,
  type CreateAccountBody,
  type Decimal,
  type LinkResidualTarget,
  type TransactionModel,
} from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Currencies from '@models/currencies.model';
import { Response } from 'express';

import { makeRequest } from './common';
import { addUserCurrencies, getCurrenciesRates } from './currencies';

export const buildAccountPayload = (overrides: Partial<CreateAccountBody> = {}): CreateAccountBody => ({
  accountCategory: ACCOUNT_CATEGORIES.general,
  currencyCode: global.BASE_CURRENCY.code,
  name: 'test',
  type: ACCOUNT_TYPES.system,
  initialBalance: 0,
  creditLimit: 0,
  ...overrides,
});
type BuildAccountPayload = ReturnType<typeof buildAccountPayload>;

export function getAccount({ id, raw }: { id: string; raw: false }): Promise<Response>;
export function getAccount({ id, raw }: { id: string; raw: true }): Promise<Accounts>;
export function getAccount({ id, raw = false }: { id: string; raw?: boolean }) {
  return makeRequest({
    method: 'get',
    url: `/accounts/${id}`,
    raw,
  });
}

export function getAccountTransactionCount<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<{ transactionCount: number }, R>({
    method: 'get',
    url: `/accounts/${id}/transaction-count`,
    raw,
  });
}

export function getAccounts(): Promise<Accounts[]> {
  return makeRequest({
    method: 'get',
    url: `/accounts`,
    raw: true,
  });
}

/**
 * Creates an account. By default for base currency, but any payload can be passed
 */
export function createAccount(): Promise<Response>;
export function createAccount({ payload, raw }: { payload?: BuildAccountPayload; raw: false }): Promise<Response>;
export function createAccount({ payload, raw }: { payload?: BuildAccountPayload; raw: true }): Promise<Accounts>;
export function createAccount({ payload = buildAccountPayload(), raw = false } = {}) {
  return makeRequest({
    method: 'post',
    url: '/accounts',
    payload,
    raw,
  });
}

type UpdateAccountPayload = Partial<BuildAccountPayload> & {
  status?: ACCOUNT_STATUSES;
  excludeFromStats?: boolean;
};

export function updateAccount<T = AccountApiResponse, R extends boolean | undefined = undefined>({
  id,
  payload = {},
  raw,
}: {
  id: string;
  payload?: UpdateAccountPayload;
  raw?: R;
}) {
  return makeRequest<T, R>({
    method: 'put',
    url: `/accounts/${id}`,
    payload,
    raw,
  });
}

export function deleteAccount(params: {
  id: string;
  removePortfolioTransfers?: boolean;
  raw: false;
}): Promise<Response>;
export function deleteAccount(params: { id: string; removePortfolioTransfers?: boolean; raw: true }): Promise<void>;
export function deleteAccount({
  id,
  removePortfolioTransfers,
  raw = false,
}: {
  id: string;
  removePortfolioTransfers?: boolean;
  raw?: boolean;
}) {
  return makeRequest({
    method: 'delete',
    url: `/accounts/${id}${removePortfolioTransfers ? '?removePortfolioTransfers=true' : ''}`,
    raw,
  });
}

export function unlinkAccountFromBankConnection({ id, raw }: { id: string; raw: false }): Promise<Response>;
export function unlinkAccountFromBankConnection({ id, raw }: { id: string; raw: true }): Promise<Accounts>;
export function unlinkAccountFromBankConnection({ id, raw = false }: { id: string; raw?: boolean }) {
  return makeRequest({
    method: 'post',
    url: `/accounts/${id}/unlink`,
    raw,
  });
}

export function linkAccountToBankConnection<R extends boolean | undefined = undefined>({
  id,
  connectionId,
  externalAccountId,
  residualTarget,
  raw,
}: {
  id: string;
  connectionId: string;
  externalAccountId: string;
  residualTarget?: LinkResidualTarget;
  raw?: R;
}) {
  return makeRequest<
    {
      account: Accounts;
      balanceDifference: number;
      message: string;
    },
    R
  >({
    method: 'post',
    url: `/accounts/${id}/link`,
    payload: {
      connectionId,
      externalAccountId,
      residualTarget,
    },
    raw,
  });
}

export function balanceAdjustment<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: { targetBalance: Decimal; note?: string; time?: string };
  raw?: R;
}) {
  return makeRequest<
    {
      transaction: TransactionModel | null;
      previousBalance: number;
      newBalance: number;
    },
    R
  >({
    method: 'post',
    url: `/accounts/${id}/balance-adjustment`,
    payload,
    raw,
  });
}

export const createAccountWithNewCurrency = async ({ currency }: { currency: string }) => {
  const currencyA: Currencies = global.MODELS_CURRENCIES!.find((item: Currencies) => item.code === currency);
  await addUserCurrencies({ currencyCodes: [currencyA.code] });

  const account = await createAccount({
    payload: {
      ...buildAccountPayload(),
      currencyCode: currencyA.code,
    },
    raw: true,
  });

  const currencies = await getCurrenciesRates({ codes: [currency] });

  return { account, currency: currencyA, currencyRate: currencies[0] };
};
