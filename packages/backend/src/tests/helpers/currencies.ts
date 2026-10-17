import type { BaseCurrencyChangeStatus } from '@bt/shared/types';
import { CURRENCY_CODE_COLUMNS } from '@common/lib/currency-code-columns';
import Currencies from '@models/currencies.model';
import ExchangeRates from '@models/exchange-rates.model';
import { connection } from '@models/index';
import { UpdateExchangeRatePair } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { addUserCurrencies as apiAddUserCurrencies } from '@root/services/currencies/add-user-currency';
import {
  deleteUserCurrency as apiDeleteUserCurrency,
  editUserCurrency as apiEditUserCurrency,
} from '@root/services/user.service';

import { makeRequest } from './common';

export async function getUserCurrencies(): Promise<(UsersCurrencies & { currency: Currencies })[]> {
  const data = await makeRequest({
    method: 'get',
    url: '/user/currencies',
    raw: true,
  });

  return data;
}

export async function getCurrenciesRates({ codes }: { codes?: string[] } = {}): Promise<ExchangeRates[]> {
  const data = await makeRequest({
    method: 'get',
    url: '/user/currencies/rates',
    raw: true,
  });

  return codes ? data.filter((item) => codes.includes(item.baseCode)) : data;
}

export function addUserCurrencies<R extends boolean | undefined = undefined>({
  currencyCodes = [],
  raw,
}: {
  currencyCodes?: string[];
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiAddUserCurrencies>>, R>({
    method: 'post',
    url: '/user/currencies',
    payload: {
      currencies: currencyCodes.map((code) => ({
        currencyCode: code,
      })),
    },
    raw,
  });
}

export function addUserCurrencyByCode<R extends boolean | undefined = undefined>({
  code,
  raw,
}: {
  code: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiAddUserCurrencies>>, R>({
    method: 'post',
    url: '/user/currencies',
    payload: {
      currencies: [
        {
          currencyCode: code,
        },
      ],
    },
    raw,
  });
}

export function deleteUserCurrency<R extends boolean | undefined = undefined>({
  currencyCode,
  raw,
}: {
  currencyCode: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiDeleteUserCurrency>>, R>({
    method: 'delete',
    url: '/user/currency',
    payload: { currencyCode },
    raw,
  });
}

export function editUserCurrencyExchangeRate({ pairs }: { pairs: UpdateExchangeRatePair[] }) {
  return makeRequest({
    method: 'put',
    url: '/user/currency/rates',
    payload: { pairs },
    raw: true,
  });
}

export function getAllCurrencies(): Promise<Currencies[]> {
  return makeRequest({
    method: 'get',
    url: '/models/currencies',
    raw: true,
  });
}

export async function addUserCurrenciesWithRates<R extends boolean | undefined = undefined>({
  currencies,
  raw,
}: {
  currencies: {
    currencyCode: string;
    exchangeRate?: number;
    liveRateUpdate?: boolean;
  }[];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiAddUserCurrencies>>, R>({
    method: 'post',
    url: '/user/currencies',
    payload: { currencies },
    raw,
  });
}

export async function updateUserCurrency<R extends boolean | undefined = undefined>({
  currency,
  raw,
}: {
  currency: Omit<Parameters<typeof apiEditUserCurrency>[0], 'userId'>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiEditUserCurrency>>, R>({
    method: 'put',
    url: '/user/currency',
    payload: { ...currency },
    raw,
  });
}

/**
 * POST /user/currencies/change-base. Enqueues the recalculation and resolves to
 * `{ jobId, state: 'queued' }` (HTTP 202). Share-blocker / same-currency rejections
 * still surface synchronously. Poll the result via {@link changeBaseCurrencyAndWait}.
 */
export function changeBaseCurrency<R extends boolean | undefined = undefined>({
  newCurrencyCode,
  raw,
}: {
  newCurrencyCode: string;
  raw?: R;
}) {
  return makeRequest<{ jobId: string; state: 'queued' }, R>({
    method: 'post',
    url: '/user/currencies/change-base',
    payload: { newCurrencyCode },
    raw,
  });
}

export function getBaseCurrencyChangeStatus<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<BaseCurrencyChangeStatus, R>({
    method: 'get',
    url: '/user/currencies/change-base/status',
    raw,
  });
}

/**
 * Enqueue a base-currency change and poll the status endpoint every 100ms until it
 * settles. The recalculation runs in a BullMQ worker, so the POST only returns
 * `{ jobId }` — callers must poll for the terminal state. Mirrors
 * `waitForCsvImportCompletion`.
 */
export async function changeBaseCurrencyAndWait({
  newCurrencyCode,
  timeoutMs = 30_000,
}: {
  newCurrencyCode: string;
  timeoutMs?: number;
}): Promise<BaseCurrencyChangeStatus> {
  const enqueueRes = await changeBaseCurrency({ newCurrencyCode });
  if (enqueueRes.statusCode !== 202) {
    throw new Error(
      `Expected 202 from change-base enqueue, got ${enqueueRes.statusCode}: ${JSON.stringify(enqueueRes.body)}`,
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getBaseCurrencyChangeStatus({ raw: true });
    if (status.state === 'completed' || status.state === 'failed') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Base-currency change did not finish within ${timeoutMs}ms`);
}

/**
 * Poll the status endpoint (without enqueueing) until the change settles to a
 * terminal state (`completed`, `failed`, or `idle`). Used to drain a job that was
 * enqueued out-of-band so it doesn't run against the next test's truncated DB.
 */
export async function waitForBaseCurrencyChangeSettled({
  timeoutMs = 30_000,
}: { timeoutMs?: number } = {}): Promise<BaseCurrencyChangeStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getBaseCurrencyChangeStatus({ raw: true });
    if (status.state === 'completed' || status.state === 'failed' || status.state === 'idle') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Base-currency change did not settle within ${timeoutMs}ms`);
}

/** Narrow a terminal status to `completed` so tests can read `result` directly.
 *  Throws (failing the calling test) when the worker finished with `failed`. */
export function expectBaseCurrencyChangeCompleted(
  status: BaseCurrencyChangeStatus,
): asserts status is Extract<BaseCurrencyChangeStatus, { state: 'completed' }> {
  if (status.state !== 'completed') {
    const detail = status.state === 'failed' ? ` Error: ${status.error}` : '';
    throw new Error(`Expected completed base-currency change, got state="${status.state}".${detail}`);
  }
}

/** Narrow a terminal status to `failed` so tests can read `error` directly. */
export function expectBaseCurrencyChangeFailed(
  status: BaseCurrencyChangeStatus,
): asserts status is Extract<BaseCurrencyChangeStatus, { state: 'failed' }> {
  if (status.state !== 'failed') {
    throw new Error(`Expected failed base-currency change, got state="${status.state}".`);
  }
}

/**
 * Insert a user-defined currency straight into the shared `Currencies` table, the way the custom-currency
 * endpoint will. The table survives the between-test truncation, so every test that calls this must pair it
 * with {@link removeCustomCurrencyRow}.
 */
export async function seedCustomCurrencyRow({
  code,
  name = code,
  digits = 8,
  createdByUserId = null,
}: {
  code: string;
  name?: string;
  digits?: number;
  createdByUserId?: number | null;
}) {
  return Currencies.create({
    code,
    currency: name,
    digits,
    number: null,
    isCustom: true,
    createdByUserId,
  });
}

/**
 * Remove a row created by {@link seedCustomCurrencyRow} together with the rows that reference it: every
 * currency-code column is cleared, transactions first and accounts last, so a test that went on to create
 * accounts or transactions in the custom currency can still clean up.
 */
export async function removeCustomCurrencyRow({ code }: { code: string }) {
  const rank = (table: string) => (table === 'Transactions' ? 0 : table === 'Accounts' ? 2 : 1);
  const ordered = CURRENCY_CODE_COLUMNS.filter(({ table }) => table !== 'Currencies').toSorted(
    (a, b) => rank(a.table) - rank(b.table),
  );

  for (const { table, column } of ordered) {
    await connection.sequelize.query(`DELETE FROM "${table}" WHERE "${column}" = :code`, { replacements: { code } });
  }

  await Currencies.destroy({ where: { code, isCustom: true } });
}
