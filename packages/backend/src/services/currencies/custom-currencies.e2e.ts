import {
  type AccountApiResponse,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { redisClient } from '@root/redis-client';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { RateLimitService } from '@services/common/rate-limit.service';
import { buildRefAmountCachePattern } from '@services/ref-amount-cache';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const SAT = 'SAT';
const USDT = 'USDT';
/** AED per 1 unit of the custom currency in the tests below. */
const RATE = 2;

const sat = ({
  decimals = 8,
  name = 'Satoshi',
  symbol,
}: { decimals?: number; name?: string; symbol?: string } = {}) => ({
  code: SAT,
  name,
  decimals,
  ...(symbol !== undefined && { symbol }),
});

/** The user's own rate between a custom code and the base currency, in both directions. */
const setRate = ({ code, rate = RATE }: { code: string; rate?: number }) =>
  helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: code, quoteCode: global.BASE_CURRENCY_CODE, rate },
      { baseCode: global.BASE_CURRENCY_CODE, quoteCode: code, rate: 1 / rate },
    ],
    raw: true,
  });

const createCustomAccount = async ({ code, name = 'Custom account' }: { code: string; name?: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

/**
 * `ownCategory` takes the active user's own first category instead of the suite user's default one,
 * for a second user writing on an account of their own.
 */
const createExpense = async ({
  accountId,
  amount,
  ownCategory = false,
}: {
  accountId: string;
  amount: number;
  ownCategory?: boolean;
}) => {
  const categoryId = ownCategory ? (await helpers.getCategoriesList())[0]!.id : global.DEFAULT_CATEGORY_ID;
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId,
      transactionType: TRANSACTION_TYPES.expense,
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200)
    throw new Error(`createTransaction answered ${body.statusCode}: ${JSON.stringify(body.body)}`);

  return body.body.response[0]!;
};

const accountTransactions = async ({ accountId }: { accountId: string }) =>
  (await helpers.getTransactions({
    accountIds: [accountId as RecordId],
    raw: true,
  })) as unknown as TransactionApiResponse[];

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

const userId = async () =>
  ((await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number }).id;

describe('Custom currencies', () => {
  describe('POST, GET /user/currencies/custom', () => {
    it('starts with no custom currencies', async () => {
      const response = await helpers.listCustomCurrencies();

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual([]);
    });

    it('creates a currency with the number of decimals the user chose', async () => {
      const created = await helpers.createCustomCurrency({ payload: sat({ decimals: 8, symbol: 'sat' }) });

      expect(created.statusCode).toBe(201);
      expect(created.body.response).toEqual({
        code: SAT,
        name: 'Satoshi',
        decimals: 8,
        symbol: 'sat',
        isCustom: true,
      });

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([created.body.response]);
    });

    it('shows the currency, with the user definition applied, in the user currency list', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 3, name: 'Sats', symbol: 'S' }) });

      const userCurrencies = await helpers.getUserCurrencies();
      const entry = userCurrencies.find((item) => item.currencyCode === SAT);

      expect(entry).toBeDefined();
      expect(entry!.liveRateUpdate).toBe(false);
      expect(entry!.currency).toMatchObject({ code: SAT, currency: 'Sats', digits: 3, symbol: 'S', isCustom: true });
    });

    it('keeps the custom currency out of the public currency list', async () => {
      await helpers.createCustomCurrency({ payload: sat() });

      const all = await helpers.getAllCurrencies();

      expect(all.map((currency) => currency.code)).not.toContain(SAT);
    });

    it.each([
      ['a code with a symbol character', { ...sat(), code: 'S-T' }],
      ['a code that is too short', { ...sat(), code: 'S' }],
      ['a code that is too long', { ...sat(), code: 'A'.repeat(17) }],
      ['more than 18 decimals', sat({ decimals: 19 })],
      ['a negative number of decimals', sat({ decimals: -1 })],
      ['a fractional number of decimals', sat({ decimals: 1.5 })],
      ['an empty name', sat({ name: '  ' })],
      ['a symbol over 8 characters', sat({ symbol: 'TOOLONGSYM' })],
    ])('rejects %s with 422', async (_label, payload) => {
      const response = await helpers.createCustomCurrency({ payload });

      expect(response.statusCode).toBe(422);
    });

    it('rejects an ISO 4217 code with 409, whether or not it is in the seed', async () => {
      for (const code of ['USD', 'XAU']) {
        const response = await helpers.createCustomCurrency({ payload: { ...sat(), code } });

        expect(response.statusCode).toBe(409);
      }
    });

    it('rejects a second definition of the same code by the same user with 409', async () => {
      await helpers.createCustomCurrency({ payload: sat() });

      const duplicate = await helpers.createCustomCurrency({ payload: sat({ decimals: 2 }) });

      expect(duplicate.statusCode).toBe(409);
      expect((await helpers.listCustomCurrencies({ raw: true })).map((item) => item.decimals)).toEqual([8]);
    });

    it("keeps another user's currency out of reach", async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const other = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
          expect((await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Mine' } })).statusCode).toBe(404);
          expect((await helpers.deleteCustomCurrency({ code: SAT })).statusCode).toBe(404);

          const userCurrencies = await helpers.getUserCurrencies();
          expect(userCurrencies.map((item) => item.currencyCode)).not.toContain(SAT);

          // The code reads as unknown until the user defines it themselves.
          const account = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ currencyCode: SAT }),
            raw: false,
          });
          expect(account.statusCode).toBe(422);
        },
      });
    });

    it('lets two users define the same code with their own decimals and stores each one precision', async () => {
      const alice = await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }), raw: true });
      expect(alice.decimals).toBe(8);
      await setRate({ code: SAT });
      const aliceAccount = await createCustomAccount({ code: SAT });
      const aliceTx = await createExpense({ accountId: aliceAccount.id, amount: 0.123456789 });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const created = await helpers.createCustomCurrency({ payload: sat({ decimals: 0, name: 'Sats' }) });
          expect(created.statusCode).toBe(201);
          expect(created.body.response).toMatchObject({ decimals: 0, name: 'Sats' });

          await setRate({ code: SAT });
          const bobAccount = await createCustomAccount({ code: SAT });
          const bobTx = await createExpense({ accountId: bobAccount.id, amount: 1.5, ownCategory: true });

          expect(Number(bobTx.amount)).toBe(2);
          expect(bobAccount.currencyMeta).toEqual({ decimals: 0, symbol: null, isCustom: true });
          expect((await helpers.getUserCurrencies()).find((item) => item.currencyCode === SAT)!.currency).toMatchObject(
            {
              digits: 0,
              currency: 'Sats',
            },
          );
        },
      });

      expect(Number(aliceTx.amount)).toBe(0.12345679);
      expect(aliceAccount.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });
      expect((await helpers.listCustomCurrencies({ raw: true }))[0]).toMatchObject({ decimals: 8, name: 'Satoshi' });
    });
  });

  describe('PUT /user/currencies/custom/:code', () => {
    it('renames the currency and changes its symbol at any time', async () => {
      await helpers.createCustomCurrency({ payload: sat({ symbol: 'S' }) });
      await setRate({ code: SAT });
      await createCustomAccount({ code: SAT });

      const updated = await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Sats', symbol: null } });

      expect(updated.statusCode).toBe(200);
      expect(updated.body.response).toEqual({ code: SAT, name: 'Sats', decimals: 8, symbol: null, isCustom: true });
    });

    it('changes the decimals while none of the user rows use the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });

      const updated = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });

      expect(updated.statusCode).toBe(200);
      expect(updated.body.response).toMatchObject({ decimals: 2 });
      expect((await helpers.getUserCurrencies()).find((item) => item.currencyCode === SAT)!.currency.digits).toBe(2);

      // New amounts round to the new decimals.
      await setRate({ code: SAT });
      const account = await createCustomAccount({ code: SAT });
      const transaction = await createExpense({ accountId: account.id, amount: 1.005 });
      expect(Number(transaction.amount)).toBe(1.01);
    });

    it('drops the cached converted amounts of the user when the decimals change', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      const ownId = await userId();
      const cachedKey = `ref_amount:v2:${ownId}:1.000000000000000000:${SAT}:${global.BASE_CURRENCY_CODE}:2025-01-01`;
      const otherUsersKey = `ref_amount:v2:${ownId + 1000}:1.000000000000000000:${SAT}:${global.BASE_CURRENCY_CODE}:2025-01-01`;
      await redisClient.set(cachedKey, '2.00');
      await redisClient.set(otherUsersKey, '2.00');
      expect(buildRefAmountCachePattern({ userId: ownId })).toBe(`ref_amount:v2:${ownId}:*`);

      await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Sats' } });
      expect(await redisClient.get(cachedKey)).toBe('2.00');

      await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });

      expect(await redisClient.get(cachedKey)).toBeNull();
      expect(await redisClient.get(otherUsersKey)).toBe('2.00');
    });

    it('refuses a decimals change with 409 while an account uses the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      await setRate({ code: SAT });
      await createCustomAccount({ code: SAT });

      const response = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });

      expect(response.statusCode).toBe(409);
      expect(errorOf(response).details).toEqual({ usedBy: ['accounts'] });
      expect((await helpers.listCustomCurrencies({ raw: true }))[0]!.decimals).toBe(8);
    });

    it('accepts the decimals the currency already has even while it is in use', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      await setRate({ code: SAT });
      await createCustomAccount({ code: SAT });

      const response = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 8, name: 'Sats' } });

      expect(response.statusCode).toBe(200);
    });

    it('answers 404 for a code the user did not define and 422 for a bad body', async () => {
      expect((await helpers.updateCustomCurrency({ code: 'NOPE', payload: { name: 'x' } })).statusCode).toBe(404);

      await helpers.createCustomCurrency({ payload: sat() });
      expect((await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 40 } })).statusCode).toBe(422);
    });
  });

  describe('DELETE /user/currencies/custom/:code', () => {
    it('removes an unused currency together with its rates and its global row', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      await setRate({ code: SAT });
      expect(await UserExchangeRates.count({ where: { baseCode: SAT } })).toBe(1);

      const response = await helpers.deleteCustomCurrency({ code: SAT });

      expect(response.statusCode).toBe(200);
      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
      expect(await UserExchangeRates.count({ where: { baseCode: SAT } })).toBe(0);
      expect(await Currencies.findByPk(SAT)).toBeNull();
    });

    it('refuses with 409 while an account uses the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      await setRate({ code: SAT });
      await createCustomAccount({ code: SAT });

      const response = await helpers.deleteCustomCurrency({ code: SAT });

      expect(response.statusCode).toBe(409);
      expect(errorOf(response).details).toEqual({ usedBy: ['accounts'] });
      expect(await helpers.listCustomCurrencies({ raw: true })).toHaveLength(1);
    });

    it('keeps the global row for the other users who still hold the code', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const bob = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.createCustomCurrency({ payload: sat({ decimals: 0 }), raw: true }),
      });

      await helpers.deleteCustomCurrency({ code: SAT });

      const row = await Currencies.findByPk(SAT);
      expect(row).not.toBeNull();
      // The creator no longer holds it, so the row stops naming them.
      expect(row!.createdByUserId).toBeNull();
      expect(
        await helpers.asUser({ cookies: bob.cookies, fn: () => helpers.listCustomCurrencies({ raw: true }) }),
      ).toHaveLength(1);
    });

    it('answers 404 for a code the user did not define', async () => {
      expect((await helpers.deleteCustomCurrency({ code: 'NOPE' })).statusCode).toBe(404);
    });

    it('is the only way to drop a custom currency: the generic endpoint refuses it with 422', async () => {
      await helpers.createCustomCurrency({ payload: sat() });

      const response = await helpers.deleteUserCurrency({ currencyCode: SAT });

      expect(response.statusCode).toBe(422);
      expect(await helpers.listCustomCurrencies({ raw: true })).toHaveLength(1);
    });
  });

  describe('a shared account in a custom currency', () => {
    it("rounds every native amount with the account owner's decimals, whoever enters it", async () => {
      // Alice owns SAT with 8 decimals; Bob defines the same code with 0.
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      await setRate({ code: SAT });
      const account = await createCustomAccount({ code: SAT, name: 'Shared SAT' });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: bob.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.write,
        policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
        raw: true,
      });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
          await helpers.createCustomCurrency({ payload: sat({ decimals: 0 }), raw: true });
          await setRate({ code: SAT, rate: 4 });

          const create = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id as RecordId,
              amount: 1.25,
              transactionType: TRANSACTION_TYPES.expense,
            }),
            raw: false,
          });
          expect(create.statusCode).toBe(200);
          const [created] = (create as unknown as { body: { response: TransactionApiResponse[] } }).body.response;

          // Bob's own definition would make this 1; the owner's makes it 1.25.
          expect(Number(created!.amount)).toBe(1.25);
          expect(Number(created!.refAmount)).toBe(5);
          expect(created!.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });

          // The owner's decimals also cap the extra precision.
          const precise = await createExpense({ accountId: account.id, amount: 0.123456789 });
          expect(Number(precise.amount)).toBe(0.12345679);

          const sharedAccount = (await helpers.getAccounts()).find(
            (candidate) => candidate.id === account.id,
          ) as unknown as AccountApiResponse | undefined;
          expect(sharedAccount?.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });

          const list = await accountTransactions({ accountId: account.id });
          expect(list).toHaveLength(2);
          expect(list.every((transaction) => transaction.currencyMeta?.decimals === 8)).toBe(true);

          // Bob's own list still shows his definition.
          expect((await helpers.listCustomCurrencies({ raw: true }))[0]!.decimals).toBe(0);
        },
      });

      // The rows the account holds keep the owner's precision for the owner too.
      const ownerView = await accountTransactions({ accountId: account.id });
      expect(ownerView.map((transaction) => Number(transaction.amount)).toSorted()).toEqual([0.12345679, 1.25]);
    });
  });

  describe('where custom currencies are not accepted', () => {
    it('keeps ISO-only validation for loans, portfolios and the base currency', async () => {
      await helpers.createCustomCurrency({ payload: { code: USDT, name: 'Tether', decimals: 6 } });

      const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload({ currencyCode: USDT }) });
      expect(loan.statusCode).toBe(422);

      const portfolio = await helpers.createPortfolio({ payload: { displayCurrencyCode: USDT } });
      expect(portfolio.statusCode).toBe(422);

      const changeBase = await helpers.changeBaseCurrency({ newCurrencyCode: USDT });
      expect(changeBase.statusCode).toBe(422);

      const setBase = await helpers.makeRequest({
        method: 'post',
        url: '/user/currencies/base',
        payload: { currencyCode: USDT },
      });
      expect(setBase.statusCode).toBe(422);
    });
  });

  describe('clean-up when a user goes away', () => {
    beforeEach(async () => {
      await RateLimitService.resetRateLimit(`backup:user:${await userId()}`);
      await RateLimitService.resetRateLimit(`backup-restore:user:${await userId()}`);
    });

    it('removes the global row of a user who deleted their account and was its only holder', async () => {
      const bob = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.createCustomCurrency({ payload: sat() });
          expect(await Currencies.findByPk(SAT)).not.toBeNull();

          const deleted = await helpers.deleteUserAccount();
          expect(deleted.statusCode).toBe(200);
        },
      });

      expect(await Currencies.findByPk(SAT)).toBeNull();
    });

    it('keeps the row, without the departed creator, when another user holds the same code', async () => {
      const bob = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.createCustomCurrency({ payload: sat({ decimals: 0 }), raw: true }),
      });
      expect((await Currencies.findByPk(SAT))!.createdByUserId).not.toBeNull();

      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }), raw: true });

      await helpers.asUser({ cookies: bob.cookies, fn: () => helpers.deleteUserAccount() });

      const row = await Currencies.findByPk(SAT);
      expect(row).not.toBeNull();
      expect(row!.createdByUserId).toBeNull();
      expect((await helpers.listCustomCurrencies({ raw: true }))[0]).toMatchObject({ code: SAT, decimals: 8 });
    });

    it('removes the global row when the only holder wipes their data', async () => {
      await helpers.createCustomCurrency({ payload: sat() });

      const wiped = await helpers.wipeUserData();
      expect(wiped.statusCode).toBe(200);

      expect(await Currencies.findByPk(SAT)).toBeNull();
      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
    });
  });

  describe('backup and restore', () => {
    beforeEach(async () => {
      await RateLimitService.resetRateLimit(`backup:user:${await userId()}`);
      await RateLimitService.resetRateLimit(`backup-restore:user:${await userId()}`);
    });

    it('carries the definition, the overrides and the account of a custom currency to a fresh instance', async () => {
      await helpers.createCustomCurrency({ payload: { code: USDT, name: 'Tether', decimals: 6, symbol: 'T' } });
      await setRate({ code: USDT, rate: 3.5 });
      const account = await createCustomAccount({ code: USDT, name: 'Stable' });
      await createExpense({ accountId: account.id, amount: 0.123456 });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const reference = JSON.parse(archive.files.get('reference/custom-currencies.json')!.toString('utf8'));
      expect(reference).toEqual([{ code: USDT, currency: 'Tether', digits: 6, symbol: 'T', isCustom: true }]);
      expect(JSON.stringify(reference)).not.toContain('createdByUserId');

      // A fresh instance has neither the user rows nor the global currency row.
      await helpers.wipeUserData();
      expect(await Currencies.findByPk(USDT)).toBeNull();

      const restore = await helpers.restoreBackup({ fileContent: exported.body.toString('base64') });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      const row = await Currencies.findByPk(USDT);
      expect(row).toMatchObject({ isCustom: true, digits: 6, symbol: 'T', number: null });
      expect(row!.createdByUserId).not.toBeNull();

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([
        { code: USDT, name: 'Tether', decimals: 6, symbol: 'T', isCustom: true },
      ]);

      const restoredAccount = (await helpers.getAccounts()).find((candidate) => candidate.name === 'Stable');
      expect(restoredAccount).toBeDefined();
      expect(restoredAccount!.currencyCode).toBe(USDT);
      const restoredTransactions = await accountTransactions({ accountId: restoredAccount!.id });
      expect(restoredTransactions.map((transaction) => Number(transaction.amount))).toContain(0.123456);
    });

    it("never attaches another user's custom currency that an archive names without defining", async () => {
      const bob = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.createCustomCurrency({ payload: { code: USDT, name: 'Bob USDT', decimals: 2 }, raw: true }),
      });

      await helpers.createCustomCurrency({ payload: { code: USDT, name: 'Tether', decimals: 6 } });
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });

      // The archive keeps the user holding but loses the definition that vouches for it.
      archive.files.set('reference/custom-currencies.json', Buffer.from('[]'));
      const tampered = await helpers.repackBackup({ files: archive.files });

      const restore = await helpers.restoreBackup({ fileContent: tampered });
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
    });
  });
});
