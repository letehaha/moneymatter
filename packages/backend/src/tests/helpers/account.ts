import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountApiResponse,
  BANK_PROVIDER_TYPE,
  type CreateAccountBody,
  type Decimal,
  type LinkResidualTarget,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionModel,
  asDecimal,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { expect } from '@jest/globals';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import Currencies from '@models/currencies.model';
import * as helpers from '@tests/helpers';
import type { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import {
  LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';
import { addHours, format, startOfDay, subDays } from 'date-fns';
import { Response } from 'express';

import { type CustomResponse, makeRequest } from './common';
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

export function unlinkAccountFromBankConnection({
  id,
  raw,
}: {
  id: string;
  raw: false;
}): Promise<CustomResponse<AccountApiResponse>>;
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

/** A linked account whose seam is not stamped yet stays fully owned by the bank. */
export const dropSeam = async ({ accountId }: { accountId: string }) => {
  await connection.sequelize.query(`UPDATE "Accounts" SET "seamBalance" = NULL WHERE "id" = :accountId`, {
    replacements: { accountId },
  });
};

/** No HTTP call can date a link in the past, so the test moves the stored link moment. */
export const backdateLink = async ({ accountId, linkedAt }: { accountId: string; linkedAt: Date }) => {
  await connection.sequelize.query(
    `UPDATE "Accounts"
        SET "externalData" = jsonb_set("externalData", '{bankConnection,linkedAt}', to_jsonb(CAST(:linkedAt AS text)))
      WHERE "id" = :accountId`,
    { replacements: { accountId, linkedAt: linkedAt.toISOString() } },
  );
};

/** Links `accountId` to a LunchFlow account reporting `balance` in `currency`. */
export const linkToLunchFlow = async ({
  accountId,
  connectionId,
  externalAccountId = LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
  currency = 'USD',
  balance = 1200,
  residualTarget,
  bankTransactions = { transactions: [], total: 0 },
}: {
  accountId: string;
  connectionId?: string;
  externalAccountId?: string;
  currency?: string;
  balance?: number;
  residualTarget?: LinkResidualTarget;
  bankTransactions?: ReturnType<typeof getMockedLunchFlowTransactions>;
}) => {
  const resolvedConnectionId =
    connectionId ??
    (
      await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      })
    ).connectionId;
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: bankTransactions, accountId: externalAccountId }),
    getLunchFlowBalanceMock({
      accountId: externalAccountId,
      response: { balance: { amount: asDecimal(balance), currency } },
    }),
  );
  const response = await linkAccountToBankConnection({
    id: accountId,
    connectionId: resolvedConnectionId,
    externalAccountId,
    residualTarget,
    raw: false,
  });
  expect(response.statusCode).toBe(200);
  return { connectionId: resolvedConnectionId };
};

/** The spanning import fixtures take 40 + 25 − 15 = 50 out before the seam; their other rows start at it. */
export const SPANNING_PRE_SEAM_NET_OUT = 50;
/** A transfer dropped at the seam counts both of its legs. */
export const SKIPPED_PER_TRANSFER = 2;

/** Opened at 1000 with a 100 expense ten days back, then linked to a bank reporting 1200: the seam is today. */
export const createSeamAccount = async ({ currencyCode = 'USD' }: { currencyCode?: string } = {}) => {
  const account = await createAccount({
    payload: buildAccountPayload({ name: 'Manual account', currencyCode, initialBalance: 1000 }),
    raw: true,
  });
  const [category] = await helpers.getCategoriesList();
  const day = format(subDays(startOfDay(new Date()), 10), 'yyyy-MM-dd');
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: category!.id as RecordId,
      amount: 100,
      transactionType: TRANSACTION_TYPES.expense,
      time: addHours(new Date(`${day}T00:00:00.000Z`), 12).toISOString(),
      note: 'Manual row',
    }),
    raw: true,
  });
  await linkToLunchFlow({ accountId: account.id, currency: currencyCode });
  return account;
};

export const readAccount = ({ accountId }: { accountId: string }) =>
  getAccount({ id: accountId, raw: true }) as unknown as Promise<AccountApiResponse>;

export const seamDayOf = async ({ accountId }: { accountId: string }) =>
  (await readAccount({ accountId })).bankSeamAt!.slice(0, 10);

type BalanceRows = Awaited<ReturnType<typeof helpers.getBalanceHistory<true>>>;

const balanceRowsFrom = ({ rows, dayKey }: { rows: BalanceRows; dayKey: string }) =>
  rows
    .filter((row) => helpers.dateKey({ date: row.date }) >= dayKey)
    .map((row) => ({ date: helpers.dateKey({ date: row.date }), amount: row.amount }))
    .toSorted((a, b) => a.date.localeCompare(b.date));

export const snapshotSeamAccount = async ({ accountId }: { accountId: string }) => {
  const [account, history] = await Promise.all([
    readAccount({ accountId }),
    helpers.getBalanceHistory({ accountId, raw: true }),
  ]);
  return { account, history };
};

/**
 * Every stored day before the seam equals the opening balance plus the account's rows up to that day,
 * in base currency. `refRate` defaults to the account's own ref/native opening ratio, so it assumes
 * one flat rate across the pre-seam days.
 */
export const expectPreSeamHistoryConsistent = async ({
  accountId,
  seamDayKey,
  refRate,
}: {
  accountId: string;
  seamDayKey: string;
  refRate?: number;
}) => {
  const [account, history, rows] = await Promise.all([
    readAccount({ accountId }),
    helpers.getBalanceHistory({ accountId, raw: true }),
    helpers.getTransactions({ accountIds: [accountId], limit: 1000, raw: true }),
  ]);
  const initialCents = Money.fromDecimal(account.initialBalance).toCents();
  const rate =
    refRate ?? (initialCents === 0 ? 1 : Money.fromDecimal(account.refInitialBalance).toCents() / initialCents);
  const signedRows = rows
    .filter((tx) => !tx.isPlanned)
    .map((tx) => ({
      date: helpers.dateKey({ date: tx.time }),
      cents:
        (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1) * Money.fromDecimal(Number(tx.amount)).toCents(),
    }));
  const preSeam = history
    .map((row) => ({ date: helpers.dateKey({ date: row.date }), cents: Math.round(Number(row.amount) * 100) }))
    .filter((row) => row.date < seamDayKey)
    .toSorted((a, b) => a.date.localeCompare(b.date));

  if (signedRows.some((row) => row.date < seamDayKey)) expect(preSeam).not.toHaveLength(0);
  expect(preSeam).toEqual(
    preSeam.map(({ date }) => ({
      date,
      cents: Math.round(
        (initialCents + signedRows.filter((row) => row.date <= date).reduce((sum, row) => sum + row.cents, 0)) * rate,
      ),
    })),
  );
  return preSeam;
};

/** `seamDayKey` defaults to the seam `before` was taken on. */
export const expectImportOnlyMovedOpening = async ({
  accountId,
  before,
  shift,
  seamDayKey = before.account.bankSeamAt!.slice(0, 10),
  refRate,
}: {
  accountId: string;
  before: Awaited<ReturnType<typeof snapshotSeamAccount>>;
  shift: number;
  seamDayKey?: string;
  refRate?: number;
}) => {
  const after = await snapshotSeamAccount({ accountId });
  expect(after.account.currentBalance).toBe(before.account.currentBalance);
  expect(after.account.initialBalance).toBe(
    Money.fromDecimal(before.account.initialBalance).add(Money.fromDecimal(shift)).toNumber(),
  );
  expect(balanceRowsFrom({ rows: after.history, dayKey: seamDayKey })).toEqual(
    balanceRowsFrom({ rows: before.history, dayKey: seamDayKey }),
  );
  await expectPreSeamHistoryConsistent({ accountId, seamDayKey, refRate });
  return after;
};
