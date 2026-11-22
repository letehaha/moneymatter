import {
  API_ERROR_CODES,
  type AccountApiResponse,
  type CreateCustomCurrencyBody,
  type EntityLogoFields,
  PLANS,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
  type UpdateCustomCurrencyBody,
  type UpdateGoalPayload,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Currencies from '@models/currencies.model';
import { connection } from '@models/index';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { RateLimitService } from '@services/common/rate-limit.service';
import { pruneUnusedCustomCurrencies } from '@services/currencies/prune-custom-currencies';
import { PNG_1X1_DATA_URL, WEBP_1X1_BYTES, WEBP_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { randomUUID } from 'crypto';

const SAT = 'SAT';
const USDT = 'USDT';
/** AED per 1 unit of the custom currency in the tests below. */
const RATE = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_LOGO = {
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
};

const pickLogo = ({ logoDomain, logoInitials, logoColor, logoIcon, logoImageId }: EntityLogoFields) => ({
  logoDomain,
  logoInitials,
  logoColor,
  logoIcon,
  logoImageId,
});

const heldLogo = async ({ code }: { code: string }) =>
  pickLogo((await helpers.getUserCurrencies()).find((item) => item.currencyCode === code)!);

const sat = ({
  decimals = 8,
  name = 'Satoshi',
  symbol,
  rate = RATE,
}: { decimals?: number; name?: string; symbol?: string; rate?: number } = {}) => ({
  code: SAT,
  name,
  decimals,
  ...(symbol !== undefined && { symbol }),
  rate: { value: rate },
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

const restoreArchive = async ({ fileContent }: { fileContent: string }) => {
  const restore = await helpers.restoreBackup({ fileContent });
  expect(restore.statusCode).toBe(200);

  return helpers.waitForRestore({ jobId: restore.jobId! });
};

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

const expectPlanRequired = (response: unknown) => {
  const { statusCode, body } = response as { statusCode: number; body: { response: ErrorResponse } };
  expect(statusCode).toBe(ERROR_CODES.PaymentRequired);
  expect(body.response.code).toBe(API_ERROR_CODES.planRequired);
};

/** Polls until a transaction waits on the row lock the prune takes (`FOR UPDATE OF c`). */
const waitForBlockedPrune = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [blocked] = (await connection.sequelize.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF c%' AND pid <> pg_backend_pid()`,
    )) as [unknown[], unknown];
    if (blocked.length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The prune never waited on the adopter lock');
};

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
        logoDomain: null,
        logoInitials: null,
        logoColor: null,
        logoIcon: null,
        logoImageId: null,
      });

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([created.body.response]);
    });

    it('stores the rate against the base currency as the rate it was created with', async () => {
      await helpers.createCustomCurrency({ payload: sat({ rate: 4 }) });

      const rates = await UserExchangeRates.findAll({
        where: { userId: await userId() },
        attributes: ['baseCode', 'quoteCode', 'rate', 'source'],
      });
      expect(
        rates
          .filter(({ baseCode, quoteCode }) => baseCode === SAT || quoteCode === SAT)
          .map(({ baseCode, quoteCode, rate, source }) => ({ baseCode, quoteCode, rate, source })),
      ).toEqual([{ baseCode: SAT, quoteCode: global.BASE_CURRENCY_CODE, rate: 4, source: 'initial' }]);
      const account = await createCustomAccount({ code: SAT });
      const transaction = await createExpense({ accountId: account.id, amount: 1.5 });
      expect(Number(transaction.refAmount)).toBe(6);
    });

    it('quotes the rate in another ISO currency the user holds', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

      const created = await helpers.createCustomCurrency({
        payload: { ...sat(), rate: { value: 3, quoteCode: 'usd' } },
      });

      expect(created.statusCode).toBe(201);
      expect(await UserExchangeRates.count({ where: { baseCode: SAT, quoteCode: 'USD' } })).toBe(1);
      expect(await UserExchangeRates.count({ where: { baseCode: SAT, quoteCode: global.BASE_CURRENCY_CODE } })).toBe(0);
    });

    it('rejects a quote the user does not hold or that is a custom currency, and creates nothing', async () => {
      await helpers.createCustomCurrency({ payload: { ...sat(), code: USDT } });

      for (const quoteCode of ['JPY', USDT]) {
        const response = await helpers.createCustomCurrency({ payload: { ...sat(), rate: { value: 1, quoteCode } } });
        expect(response.statusCode).toBe(422);
      }

      expect((await helpers.listCustomCurrencies({ raw: true })).map((item) => item.code)).toEqual([USDT]);
      expect(await UserExchangeRates.count({ where: { baseCode: SAT } })).toBe(0);
    });

    it('keeps no user definition in the shared global row', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 3, name: 'Sats', symbol: 'S' }) });

      expect((await Currencies.findByPk(SAT))!.get({ plain: true })).toEqual({
        code: SAT,
        currency: SAT,
        digits: 8,
        number: null,
        isCustom: true,
        isDisabled: false,
      });
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
      ['more than 8 decimals', sat({ decimals: 9 })],
      ['a negative number of decimals', sat({ decimals: -1 })],
      ['a fractional number of decimals', sat({ decimals: 1.5 })],
      ['an empty name', sat({ name: '  ' })],
      ['a symbol over 8 characters', sat({ symbol: 'TOOLONGSYM' })],
      ['no rate', { code: SAT, name: 'Satoshi', decimals: 8 }],
      ['a zero rate', sat({ rate: 0 })],
      ['a negative rate', sat({ rate: -1 })],
    ])('rejects %s with 422', async (_label, payload) => {
      const response = await helpers.createCustomCurrency({ payload: payload as CreateCustomCurrencyBody });

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
      const other = await helpers.provisionSecondUserWithBaseCurrency();

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
      const aliceAccount = await createCustomAccount({ code: SAT });
      const aliceTx = await createExpense({ accountId: aliceAccount.id, amount: 0.123456789 });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const created = await helpers.createCustomCurrency({ payload: sat({ decimals: 0, name: 'Sats' }) });
          expect(created.statusCode).toBe(201);
          expect(created.body.response).toMatchObject({ decimals: 0, name: 'Sats' });

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
      await createCustomAccount({ code: SAT });

      const updated = await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Sats', symbol: null } });

      expect(updated.statusCode).toBe(200);
      expect(updated.body.response).toEqual({
        code: SAT,
        name: 'Sats',
        decimals: 8,
        symbol: null,
        isCustom: true,
        logoDomain: null,
        logoInitials: null,
        logoColor: null,
        logoIcon: null,
        logoImageId: null,
      });
    });

    it('changes the decimals while none of the user rows use the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });

      const updated = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });

      expect(updated.statusCode).toBe(200);
      expect(updated.body.response).toMatchObject({ decimals: 2 });
      expect((await helpers.getUserCurrencies()).find((item) => item.currencyCode === SAT)!.currency.digits).toBe(2);

      // New amounts round to the new decimals.
      const account = await createCustomAccount({ code: SAT });
      const transaction = await createExpense({ accountId: account.id, amount: 1.005 });
      expect(Number(transaction.amount)).toBe(1.01);
      // The base-currency value follows the rounded native amount: 1.01 x RATE.
      expect(Number(transaction.refAmount)).toBe(2.02);
    });

    it('refuses a decimals change with 422 and the blockers while an account uses the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      const account = await createCustomAccount({ code: SAT });

      const response = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });

      expect(response.statusCode).toBe(422);
      expect(errorOf(response).code).toBe(API_ERROR_CODES.currencyInUse);
      expect(errorOf(response).details).toEqual({
        blockers: [{ type: 'account', id: account.id, name: account.name }],
      });
      expect((await helpers.listCustomCurrencies({ raw: true }))[0]!.decimals).toBe(8);
    });

    it('changes the decimals and clears foreign amounts in the currency, as a delete does', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      const account = await helpers.createAccount({ raw: true });
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10,
          originalAmount: 0.12345678,
          originalCurrencyCode: SAT,
        }),
        raw: true,
      });

      const response = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });
      expect(response.statusCode).toBe(200);
      expect((await helpers.listCustomCurrencies({ raw: true }))[0]!.decimals).toBe(2);

      const cleared = await helpers.getTransactionById({ id: transaction.id, raw: true });
      expect(cleared!.originalAmount).toBeNull();
      expect(cleared!.originalCurrencyCode).toBeNull();
      expect(Number(cleared!.amount)).toBe(10);
    });

    it('accepts the decimals the currency already has even while it is in use', async () => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
      await createCustomAccount({ code: SAT });

      const response = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 8, name: 'Sats' } });

      expect(response.statusCode).toBe(200);
    });

    it('answers 404 for a code the user did not define and 422 for a bad body', async () => {
      expect((await helpers.updateCustomCurrency({ code: 'NOPE', payload: { name: 'x' } })).statusCode).toBe(404);

      await helpers.createCustomCurrency({ payload: sat() });
      expect((await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 40 } })).statusCode).toBe(422);
    });

    describe('logo', () => {
      const listedLogo = async () => {
        const listed = (await helpers.listCustomCurrencies({ raw: true })).find((item) => item.code === SAT)!;
        return pickLogo(listed);
      };

      it('starts without a logo', async () => {
        const created = await helpers.createCustomCurrency({ payload: sat() });

        expect(created.body.response).toMatchObject(NO_LOGO);
        expect(await heldLogo({ code: SAT })).toEqual(NO_LOGO);
      });

      it('creates a currency with a monogram and returns it from both currency lists', async () => {
        const created = await helpers.createCustomCurrency({
          payload: { ...sat(), logoInitials: 'S', logoColor: '#ff9900' },
        });

        expect(created.statusCode).toBe(201);
        const logo = { ...NO_LOGO, logoInitials: 'S', logoColor: '#ff9900' };
        expect(created.body.response).toMatchObject(logo);
        expect(await listedLogo()).toEqual(logo);
        expect(await heldLogo({ code: SAT })).toEqual(logo);
      });

      it('replaces one logo kind with another and keeps the logo when an update does not send one', async () => {
        await helpers.createCustomCurrency({ payload: { ...sat(), logoInitials: 'S', logoColor: '#ff9900' } });

        const branded = await helpers.updateCustomCurrency({ code: SAT, payload: { logoDomain: 'bitcoin.org' } });
        expect(branded.statusCode).toBe(200);
        expect(branded.body.response).toMatchObject({ ...NO_LOGO, logoDomain: 'bitcoin.org' });

        const renamed = await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Sats' } });
        expect(renamed.body.response).toMatchObject({ name: 'Sats', logoDomain: 'bitcoin.org' });
        expect(await heldLogo({ code: SAT })).toEqual({ ...NO_LOGO, logoDomain: 'bitcoin.org' });
      });

      it('stores an uploaded image, replaces it and deletes the old one', async () => {
        const created = await helpers.createCustomCurrency({ payload: { ...sat(), logoImage: PNG_1X1_DATA_URL } });
        const firstId = created.body.response.logoImageId!;
        expect(firstId).toMatch(UUID_PATTERN);
        expect((await helpers.getLogoImage({ id: firstId })).statusCode).toBe(200);

        const replaced = await helpers.updateCustomCurrency({ code: SAT, payload: { logoImage: WEBP_1X1_DATA_URL } });
        const secondId = replaced.body.response.logoImageId!;
        expect(secondId).toMatch(UUID_PATTERN);
        expect(secondId).not.toBe(firstId);
        expect((await helpers.getLogoImage({ id: firstId })).statusCode).toBe(ERROR_CODES.NotFoundError);

        const image = await helpers.getLogoImage({ id: secondId });
        expect(image.statusCode).toBe(200);
        expect(image.body.equals(WEBP_1X1_BYTES)).toBe(true);
      });

      it('clears the image with logoImage null and deletes it', async () => {
        const created = await helpers.createCustomCurrency({ payload: { ...sat(), logoImage: PNG_1X1_DATA_URL } });
        const imageId = created.body.response.logoImageId!;

        const cleared = await helpers.updateCustomCurrency({ code: SAT, payload: { logoImage: null } });

        expect(cleared.statusCode).toBe(200);
        expect(cleared.body.response).toMatchObject(NO_LOGO);
        expect((await helpers.getLogoImage({ id: imageId })).statusCode).toBe(ERROR_CODES.NotFoundError);
      });

      it('deletes the image together with the currency', async () => {
        const created = await helpers.createCustomCurrency({ payload: { ...sat(), logoImage: PNG_1X1_DATA_URL } });
        const imageId = created.body.response.logoImageId!;

        expect((await helpers.deleteCustomCurrency({ code: SAT })).statusCode).toBe(200);

        expect((await helpers.getLogoImage({ id: imageId })).statusCode).toBe(ERROR_CODES.NotFoundError);
      });

      it.each([
        ['two logo kinds at once', { logoDomain: 'bitcoin.org', logoInitials: 'S' }],
        ['a domain with a slash', { logoDomain: 'bitcoin.org/logo' }],
        ['an image that is not a data URL', { logoImage: 'https://example.com/logo.png' }],
        ['a logoUrl', { logoUrl: 'https://example.com/logo.png' }],
      ])('rejects %s with 422 and keeps the stored logo', async (_label, payload) => {
        await helpers.createCustomCurrency({ payload: { ...sat(), logoInitials: 'S' } });

        const response = await helpers.updateCustomCurrency({
          code: SAT,
          payload: payload as UpdateCustomCurrencyBody,
        });

        expect(response.statusCode).toBe(422);
        expect(await heldLogo({ code: SAT })).toEqual({ ...NO_LOGO, logoInitials: 'S' });
      });

      it('rejects a color without a monogram or an icon on create', async () => {
        const response = await helpers.createCustomCurrency({ payload: { ...sat(), logoColor: '#ff9900' } });

        expect(response.statusCode).toBe(422);
        expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
      });

      it('answers 404 for an ISO code and leaves its logo empty', async () => {
        await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

        const response = await helpers.updateCustomCurrency({ code: 'USD', payload: { logoInitials: 'U' } });

        expect(response.statusCode).toBe(404);
        expect(await heldLogo({ code: 'USD' })).toEqual(NO_LOGO);
      });
    });
  });

  describe('DELETE /user/currencies/custom/:code', () => {
    it('removes an unused currency together with its rates and its global row', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      expect(await UserExchangeRates.count({ where: { baseCode: SAT } })).toBe(1);

      const response = await helpers.deleteCustomCurrency({ code: SAT });

      expect(response.statusCode).toBe(200);
      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
      expect(await UserExchangeRates.count({ where: { baseCode: SAT } })).toBe(0);
      expect(await Currencies.findByPk(SAT)).toBeNull();
    });

    it('refuses with 422 and the blockers while an account uses the currency', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const account = await createCustomAccount({ code: SAT });

      const response = await helpers.deleteCustomCurrency({ code: SAT });

      expect(response.statusCode).toBe(422);
      expect(errorOf(response).code).toBe(API_ERROR_CODES.currencyInUse);
      expect(errorOf(response).details).toEqual({
        blockers: [{ type: 'account', id: account.id, name: account.name }],
      });
      expect(await helpers.listCustomCurrencies({ raw: true })).toHaveLength(1);
    });

    it('refuses while only a goal uses the currency, and so does a decimals change', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const goal = await helpers.createGoal({ payload: { name: 'Sats stash', currencyCode: SAT }, raw: true });
      const blockers = [{ type: 'goal', id: goal.id, name: 'Sats stash' }];

      const deleted = await helpers.deleteCustomCurrency({ code: SAT });
      expect(deleted.statusCode).toBe(422);
      expect(errorOf(deleted).details).toEqual({ blockers });

      const updated = await helpers.updateCustomCurrency({ code: SAT, payload: { decimals: 2 } });
      expect(updated.statusCode).toBe(422);
      expect(errorOf(updated).details).toEqual({ blockers });

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([expect.objectContaining({ decimals: 8 })]);
    });

    it('keeps the global row for the other users who still hold the code', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.createCustomCurrency({ payload: sat({ decimals: 0 }), raw: true }),
      });

      await helpers.deleteCustomCurrency({ code: SAT });

      expect(await Currencies.findByPk(SAT)).not.toBeNull();
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
    /** Alice's SAT account (8 decimals) shared with write access to Bob; `bobDecimals` makes Bob define SAT himself. */
    const shareSatAccountWithBob = async ({ bobDecimals }: { bobDecimals?: number } = {}) => {
      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }) });
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
          if (bobDecimals !== undefined) {
            await helpers.createCustomCurrency({ payload: sat({ decimals: bobDecimals, rate: 4 }), raw: true });
          }
        },
      });

      return { account, bob };
    };

    const createIncomeOn = async ({ accountId, amount }: { accountId: string; amount: number }) => {
      const [created] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountId as RecordId,
          amount,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });

      return created!;
    };

    it("gives a collaborator its own copy of the owner's logo image, which outlives the owner's edit", async () => {
      const { account, bob } = await shareSatAccountWithBob();
      const ownerLogo = await helpers.updateCustomCurrency({
        code: SAT,
        payload: { logoImage: PNG_1X1_DATA_URL },
        raw: true,
      });

      const bobLogoId = await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await createIncomeOn({ accountId: account.id, amount: 1 });
          const copy = (await helpers.listCustomCurrencies({ raw: true })).find((item) => item.code === SAT)!;
          return copy.logoImageId;
        },
      });

      expect(bobLogoId).toMatch(UUID_PATTERN);
      expect(bobLogoId).not.toBe(ownerLogo.logoImageId);

      await helpers.updateCustomCurrency({ code: SAT, payload: { logoImage: null } });
      expect((await helpers.getLogoImage({ id: ownerLogo.logoImageId! })).statusCode).toBe(ERROR_CODES.NotFoundError);

      const bobImage = await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.getLogoImage({ id: bobLogoId! }),
      });
      expect(bobImage.statusCode).toBe(200);
    });

    it('lets a collaborator write while neither user has custom currencies in the plan', async () => {
      const { account, bob } = await shareSatAccountWithBob();
      const { authUserId } = await helpers.findAppUserByEmail({ email: bob.email });
      await helpers.setUserBilling({ authUserId, plan: PLANS.essential });
      await helpers.setUserBilling({ plan: PLANS.essential });

      const write = await helpers.asUser({
        cookies: bob.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id as RecordId,
              amount: 1,
              transactionType: TRANSACTION_TYPES.income,
            }),
            raw: false,
          }),
      });

      expect(write.statusCode).toBe(200);
    });

    it("rounds a refund share on the shared account with the owner's decimals", async () => {
      const { account, bob } = await shareSatAccountWithBob();

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const ownAccount = await helpers.createAccount({ raw: true });
          const purchase = await createExpense({ accountId: ownAccount.id, amount: 10, ownCategory: true });
          const refund = await createIncomeOn({ accountId: account.id, amount: 1.25 });

          const link = await helpers.createSingleRefund(
            { originalTxId: purchase.id, refundTxId: refund.id, amount: 0.5 },
            true,
          );

          expect(link.amount).toBe(0.5);
        },
      });
    });

    it("rounds the shared-account leg of an edited transfer with the owner's decimals", async () => {
      const { account, bob } = await shareSatAccountWithBob();

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const ownAccount = await helpers.createAccount({ raw: true });
          const outflow = await createExpense({ accountId: ownAccount.id, amount: 10, ownCategory: true });
          const inflow = await createIncomeOn({ accountId: account.id, amount: 1.25 });
          const link = await helpers.linkTransactions({
            payload: { ids: [[outflow.id as RecordId, inflow.id as RecordId]] },
          });
          expect(link.statusCode).toBe(200);

          const [, opposite] = await helpers.updateTransaction({
            id: outflow.id as RecordId,
            payload: { destinationAmount: 0.5 },
            raw: true,
          });

          expect(opposite!.id).toBe(inflow.id);
          expect(Number(opposite!.amount)).toBe(0.5);
        },
      });
    });

    it('refuses a write by a collaborator whose own definition of the code has other decimals', async () => {
      const { account, bob } = await shareSatAccountWithBob({ bobDecimals: 0 });
      const aliceTx = await createExpense({ accountId: account.id, amount: 1.25 });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const create = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id as RecordId,
              amount: 1.25,
              transactionType: TRANSACTION_TYPES.expense,
            }),
            raw: false,
          });
          expect(create.statusCode).toBe(422);

          const edit = await helpers.updateTransaction({ id: aliceTx.id as RecordId, payload: { amount: 2 } });
          expect(edit.statusCode).toBe(422);

          expect((await helpers.listCustomCurrencies({ raw: true }))[0]!.decimals).toBe(0);
        },
      });

      const ownerView = await accountTransactions({ accountId: account.id });
      expect(ownerView.map((transaction) => Number(transaction.amount))).toEqual([1.25]);
    });

    it("lets a collaborator whose definition has the owner's decimals write with the owner's precision", async () => {
      const { account, bob } = await shareSatAccountWithBob({ bobDecimals: 8 });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const precise = await createExpense({ accountId: account.id, amount: 0.123456789 });
          expect(Number(precise.amount)).toBe(0.12345679);
          expect(precise.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });
          // Priced at Bob's own rate (4), not Alice's (2).
          expect(Number(precise.refAmount)).toBe(0.49);

          const deleted = await helpers.deleteCustomCurrency({ code: SAT });
          expect(deleted.statusCode).toBe(422);
          expect(errorOf(deleted).details).toEqual({
            blockers: [{ type: 'account', id: account.id, name: 'Shared SAT' }],
          });
        },
      });
    });
  });

  describe('without custom currencies in the plan', () => {
    const lapsedWithSatAccount = async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const account = await createCustomAccount({ code: SAT });
      const transaction = await createExpense({ accountId: account.id, amount: 1 });
      await helpers.setUserBilling({ plan: PLANS.essential });

      return { account, transaction };
    };

    it('refuses with 402 a new custom currency, an account in one and a goal in one', async () => {
      await lapsedWithSatAccount();

      expectPlanRequired(await helpers.createCustomCurrency({ payload: { ...sat(), code: USDT } }));
      expectPlanRequired(
        await helpers.createAccount({
          payload: helpers.buildAccountPayload({ currencyCode: SAT, initialBalance: 0 }),
          raw: false,
        }),
      );
      expectPlanRequired(await helpers.createGoal({ payload: { currencyCode: SAT } }));
    });

    it('lets a transaction on a custom-currency account be created and edited', async () => {
      const { account } = await lapsedWithSatAccount();

      const created = await createExpense({ accountId: account.id, amount: 2 });
      const edited = await helpers.updateTransaction({ id: created.id as RecordId, payload: { amount: 3 } });
      expect(edited.statusCode).toBe(200);
    });

    it('lets a custom-currency goal be renamed and its accounts changed, and refuses a goal moved to one', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const satAccount = await createCustomAccount({ code: SAT });
      const isoAccount = await helpers.createAccount({ raw: true });
      const satShare = { accountId: satAccount.id as RecordId, sharePercent: 100 };
      const isoShare = { accountId: isoAccount.id as RecordId, sharePercent: 100 };
      const goal = await helpers.createGoal({ payload: { currencyCode: SAT, accounts: [satShare] }, raw: true });
      const isoGoal = await helpers.createGoal({ raw: true });
      await helpers.setUserBilling({ plan: PLANS.essential });

      const patchGoal = (payload: UpdateGoalPayload) => helpers.updateGoal({ goalId: goal.id, payload });
      expect((await patchGoal({ name: 'Renamed' })).statusCode).toBe(200);
      expect((await patchGoal({ accounts: [satShare, isoShare] })).statusCode).toBe(200);
      expect((await patchGoal({ accounts: [isoShare] })).statusCode).toBe(200);

      expectPlanRequired(await helpers.updateGoal({ goalId: isoGoal.id, payload: { currencyCode: SAT } }));
    });

    it('keeps the data readable and lets the account be renamed and the currency edited, re-rated and deleted', async () => {
      const { account, transaction } = await lapsedWithSatAccount();

      expect((await helpers.listCustomCurrencies({ raw: true })).map((item) => item.code)).toEqual([SAT]);
      expect(await accountTransactions({ accountId: account.id })).toHaveLength(1);

      expect((await helpers.updateAccount({ id: account.id, payload: { name: 'Renamed' } })).statusCode).toBe(200);
      expect((await helpers.updateCustomCurrency({ code: SAT, payload: { name: 'Sats' } })).statusCode).toBe(200);
      const rates = await helpers.makeRequest({
        method: 'put',
        url: '/user/currency/rates',
        payload: {
          pairs: [
            { baseCode: SAT, quoteCode: global.BASE_CURRENCY_CODE, rate: 4 },
            { baseCode: global.BASE_CURRENCY_CODE, quoteCode: SAT, rate: 0.25 },
          ],
        },
      });
      expect(rates.statusCode).toBe(200);

      expect((await helpers.deleteTransaction({ id: transaction.id })).statusCode).toBe(200);
      expect((await helpers.deleteAccount({ id: account.id, raw: false })).statusCode).toBe(200);
      expect((await helpers.deleteCustomCurrency({ code: SAT })).statusCode).toBe(200);
    });
  });

  describe('where custom currencies are not accepted', () => {
    it('keeps ISO-only validation for loans, portfolios and the base currency', async () => {
      await helpers.createCustomCurrency({
        payload: { code: USDT, name: 'Tether', decimals: 6, rate: { value: RATE } },
      });

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
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
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

    it('keeps the row when another user holds the same code', async () => {
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => helpers.createCustomCurrency({ payload: sat({ decimals: 0 }), raw: true }),
      });

      await helpers.createCustomCurrency({ payload: sat({ decimals: 8 }), raw: true });

      await helpers.asUser({ cookies: bob.cookies, fn: () => helpers.deleteUserAccount() });

      expect(await Currencies.findByPk(SAT)).not.toBeNull();
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

  describe('a prune racing with a user who adopts the same code', () => {
    it('keeps the global row and the new holding when the adopter holds the row before its holding commits', async () => {
      const id = await userId();
      await helpers.createCustomCurrency({ payload: sat() });
      // Alice drops her holding, leaving the global row with no holder: what a prune would collect.
      await UsersCurrencies.destroy({ where: { userId: id, currencyCode: SAT } });

      // The adopter's transaction, stopped between taking the row lock and inserting the holding.
      const adopter = await connection.sequelize.transaction();
      await Currencies.findOne({ where: { code: SAT }, transaction: adopter, lock: adopter.LOCK.SHARE });

      const prune = connection.sequelize.transaction(async () => pruneUnusedCustomCurrencies());
      await waitForBlockedPrune();

      await UsersCurrencies.create(
        {
          userId: id,
          currencyCode: SAT,
          liveRateUpdate: false,
          isDefaultCurrency: false,
          nameOverride: 'Satoshi',
          decimalsOverride: 8,
        },
        { transaction: adopter },
      );
      await adopter.commit();

      expect(await prune).toEqual({ deletedCodes: [] });
      expect(await Currencies.findByPk(SAT)).not.toBeNull();
      expect(await UsersCurrencies.findOne({ where: { userId: id, currencyCode: SAT } })).not.toBeNull();
    });
  });

  describe('backup and restore', () => {
    beforeEach(async () => {
      await RateLimitService.resetRateLimit(`backup:user:${await userId()}`);
      await RateLimitService.resetRateLimit(`backup-restore:user:${await userId()}`);
    });

    it('carries the definition, the overrides and the account of a custom currency to a fresh instance', async () => {
      await helpers.createCustomCurrency({
        payload: { code: USDT, name: 'Tether', decimals: 6, symbol: 'T', rate: { value: 3.5 } },
      });
      const account = await createCustomAccount({ code: USDT, name: 'Stable' });
      await createExpense({ accountId: account.id, amount: 0.123456 });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      expect(holdings.find((row) => row.currencyCode === USDT)).toMatchObject({
        nameOverride: 'Tether',
        symbolOverride: 'T',
        decimalsOverride: 6,
      });

      // A fresh instance has neither the user rows nor the global currency row.
      await helpers.wipeUserData();
      expect(await Currencies.findByPk(USDT)).toBeNull();

      const restore = await helpers.restoreBackup({ fileContent: exported.body.toString('base64') });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      expect(await Currencies.findByPk(USDT)).toMatchObject({
        currency: USDT,
        isCustom: true,
        digits: 8,
        number: null,
      });

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([
        { code: USDT, name: 'Tether', decimals: 6, symbol: 'T', isCustom: true, ...NO_LOGO },
      ]);

      const restoredAccount = (await helpers.getAccounts()).find((candidate) => candidate.name === 'Stable');
      expect(restoredAccount).toBeDefined();
      expect(restoredAccount!.currencyCode).toBe(USDT);
      const restoredTransactions = await accountTransactions({ accountId: restoredAccount!.id });
      expect(restoredTransactions.map((transaction) => Number(transaction.amount))).toContain(0.123456);
    });

    it('refuses with 422 an archive that defines a custom code twice', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      const satHolding = holdings.find((row) => row.currencyCode === SAT)!;
      archive.files.set(
        'data/users-currencies.json',
        Buffer.from(JSON.stringify([...holdings, { ...satHolding, id: randomUUID(), decimalsOverride: 2 }])),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toContain(`"${SAT}"`);
      expect(await UsersCurrencies.count({ where: { userId: await userId(), currencyCode: SAT } })).toBe(1);
    });

    it('refuses with 422 an archive whose custom definition breaks the definition rules', async () => {
      await helpers.createCustomCurrency({ payload: sat() });
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      archive.files.set(
        'data/users-currencies.json',
        Buffer.from(
          JSON.stringify(holdings.map((row) => (row.currencyCode === SAT ? { ...row, decimalsOverride: 99 } : row))),
        ),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([expect.objectContaining({ code: SAT })]);
    });

    it('carries the logo image of a custom currency through export and restore as its own copy', async () => {
      const created = await helpers.createCustomCurrency({
        payload: { code: USDT, name: 'Tether', decimals: 6, rate: { value: RATE }, logoImage: PNG_1X1_DATA_URL },
        raw: true,
      });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      expect(holdings.find((row) => row.currencyCode === USDT)!.logoImageId).toBe(created.logoImageId);

      await helpers.wipeUserData();
      const status = await restoreArchive({ fileContent: exported.body.toString('base64') });
      expect(status.status).toBe('completed');

      const restored = (await helpers.listCustomCurrencies({ raw: true })).find((item) => item.code === USDT)!;
      expect(restored.logoImageId).toMatch(UUID_PATTERN);
      expect(restored.logoImageId).not.toBe(created.logoImageId);
      expect((await helpers.getLogoImage({ id: restored.logoImageId! })).statusCode).toBe(200);
    });

    it('restores an ISO holding without a logo when an archive carries one', async () => {
      const created = await helpers.createCustomCurrency({
        payload: { code: USDT, name: 'Tether', decimals: 6, rate: { value: RATE }, logoImage: PNG_1X1_DATA_URL },
        raw: true,
      });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      const forged = holdings.map((row) =>
        row.currencyCode === global.BASE_CURRENCY_CODE
          ? { ...row, logoInitials: 'X', logoColor: '#ff0000', logoImageId: created.logoImageId }
          : row,
      );
      archive.files.set('data/users-currencies.json', Buffer.from(JSON.stringify(forged)));

      await helpers.wipeUserData();
      const status = await restoreArchive({ fileContent: await helpers.repackBackup({ files: archive.files }) });
      expect(status.status).toBe('completed');

      expect(await heldLogo({ code: global.BASE_CURRENCY_CODE })).toEqual(NO_LOGO);
      expect((await heldLogo({ code: USDT })).logoImageId).toMatch(UUID_PATTERN);
    });

    describe('when another user defined the same code first', () => {
      const defineAsBob = async () => {
        const bob = await helpers.provisionSecondUserWithBaseCurrency();
        await helpers.asUser({
          cookies: bob.cookies,
          fn: () =>
            helpers.createCustomCurrency({
              payload: { code: SAT, name: 'Bob Sats', decimals: 3, symbol: 'b', rate: { value: RATE } },
              raw: true,
            }),
        });
        return bob;
      };

      it("exports the user's own definition and restores it as theirs", async () => {
        const bob = await defineAsBob();
        await helpers.createCustomCurrency({ payload: sat({ name: 'My Sats', decimals: 8 }) });

        const exported = await helpers.exportBackup();
        const archive = helpers.parseBackupArchive({ buffer: exported.body });
        const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
        expect(holdings.find((row) => row.currencyCode === SAT)).toMatchObject({
          nameOverride: 'My Sats',
          decimalsOverride: 8,
          symbolOverride: null,
        });
        expect(JSON.stringify(holdings)).not.toContain('Bob');

        await helpers.wipeUserData();
        const status = await restoreArchive({ fileContent: exported.body.toString('base64') });
        expect(status.status).toBe('completed');

        expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([
          { code: SAT, name: 'My Sats', decimals: 8, symbol: null, isCustom: true, ...NO_LOGO },
        ]);
        expect(
          await helpers.asUser({ cookies: bob.cookies, fn: () => helpers.listCustomCurrencies({ raw: true }) }),
        ).toEqual([expect.objectContaining({ name: 'Bob Sats', decimals: 3, symbol: 'b' })]);
      });

      it('drops an account that names the code without the archive defining it, and says so', async () => {
        await defineAsBob();
        await createCustomAccount({ code: global.BASE_CURRENCY_CODE, name: 'Plain' });

        const exported = await helpers.exportBackup();
        const archive = helpers.parseBackupArchive({ buffer: exported.body });
        const accounts = JSON.parse(archive.files.get('data/accounts.json')!.toString('utf8')) as {
          name: string;
          currencyCode: string;
        }[];
        archive.files.set(
          'data/accounts.json',
          Buffer.from(
            JSON.stringify(accounts.map((item) => (item.name === 'Plain' ? { ...item, currencyCode: SAT } : item))),
          ),
        );

        const status = await restoreArchive({ fileContent: await helpers.repackBackup({ files: archive.files }) });

        expect(status.status).toBe('completed');
        expect(status.summary?.warnings).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'currency_missing', table: 'accounts', count: 1 })]),
        );
        const restored = await helpers.getAccounts();
        expect(restored.some((item) => item.currencyCode === SAT)).toBe(false);
        expect(restored.some((item) => item.name === 'Plain')).toBe(false);
      });
    });

    it("never attaches another user's custom currency that an archive names without defining", async () => {
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () =>
          helpers.createCustomCurrency({
            payload: { code: USDT, name: 'Bob USDT', decimals: 2, rate: { value: RATE } },
            raw: true,
          }),
      });

      await helpers.createCustomCurrency({
        payload: { code: USDT, name: 'Tether', decimals: 6, rate: { value: RATE } },
      });
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });

      // The archive keeps the user holding but loses the definition that vouches for it.
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      archive.files.set(
        'data/users-currencies.json',
        Buffer.from(
          JSON.stringify(
            holdings.map((row) =>
              row.currencyCode === USDT
                ? { ...row, nameOverride: null, symbolOverride: null, decimalsOverride: null }
                : row,
            ),
          ),
        ),
      );
      const tampered = await helpers.repackBackup({ files: archive.files });

      const restore = await helpers.restoreBackup({ fileContent: tampered });
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
      const rates = await UserExchangeRates.findAll({
        where: { userId: await userId() },
        attributes: ['baseCode', 'quoteCode'],
      });
      expect(rates.filter((rate) => rate.baseCode === USDT || rate.quoteCode === USDT)).toEqual([]);
    });

    it('refuses with 422 an archive that defines a code that is ISO on this instance', async () => {
      const base = global.BASE_CURRENCY_CODE;
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      archive.files.set(
        'data/users-currencies.json',
        Buffer.from(
          JSON.stringify(
            holdings.map((row) =>
              row.currencyCode === base
                ? { ...row, nameOverride: 'Fake', symbolOverride: 'F', decimalsOverride: 8 }
                : row,
            ),
          ),
        ),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toContain(`"${base}" is an ISO 4217 currency code`);
    });
  });
});
