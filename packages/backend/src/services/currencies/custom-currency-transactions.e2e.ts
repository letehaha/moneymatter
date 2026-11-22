import {
  type AccountApiResponse,
  API_ERROR_CODES,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import UserExchangeRates from '@models/user-exchange-rates.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';

const BASE = (): string => global.BASE_CURRENCY_CODE;

/** The user's own rate between `code` and `quote`, in both directions, as the endpoint requires. */
const pairRates = ({ code, rate, quote = BASE() }: { code: string; rate: number; quote?: string }) => [
  { baseCode: code, quoteCode: quote, rate },
  { baseCode: quote, quoteCode: code, rate: 1 / rate },
];

const setRates = (pairs: { baseCode: string; quoteCode: string; rate: number }[]) =>
  helpers.editCurrencyExchangeRate({ pairs, raw: true });

/** `rate` is what one unit is worth in `quote`, the base currency unless given. */
const createCurrency = async ({
  code,
  decimals,
  rate,
  quote,
  name = code,
  symbol,
}: {
  code: string;
  decimals: number;
  rate: number;
  quote?: string;
  name?: string;
  symbol?: string;
}) => {
  const response = await helpers.createCustomCurrency({
    payload: { code, name, decimals, symbol, rate: { value: rate, quoteCode: quote } },
  });
  expect(response.statusCode).toBe(201);
};

const createAccountIn = async ({ code, name = `${code} account` }: { code: string; name?: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

const createTx = async ({
  accountId,
  amount,
  type = TRANSACTION_TYPES.expense,
  ownCategory = false,
  extra = {},
}: {
  accountId: string;
  amount: number;
  type?: TRANSACTION_TYPES;
  ownCategory?: boolean;
  extra?: Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>;
}) => {
  const categoryId = ownCategory ? (await helpers.getCategoriesList())[0]!.id : global.DEFAULT_CATEGORY_ID;
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId,
      transactionType: type,
      ...extra,
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200) {
    throw new Error(`createTransaction answered ${body.statusCode}: ${JSON.stringify(body.body)}`);
  }

  return body.body.response;
};

const readTx = async ({ id }: { id: string }) =>
  (await helpers.getTransactionById({ id: id as RecordId, raw: true })) as unknown as TransactionApiResponse;

const messageOf = (response: { body: unknown }) =>
  (response.body as { response: { message: string } }).response.message;

const readAccount = async ({ id }: { id: string }) =>
  (await helpers.getAccount({ id, raw: true })) as unknown as AccountApiResponse;

describe('Transactions in custom currencies', () => {
  describe('precision round trips', () => {
    it('stores 8 decimals of BTC exactly and values them in the base currency at the user rate', async () => {
      await createCurrency({ code: 'BTC', decimals: 8, name: 'Bitcoin', rate: 250000 });
      const account = await createAccountIn({ code: 'BTC' });

      const [created] = await createTx({ accountId: account.id, amount: 0.00040641 });

      expect(created!.amount).toBe(0.00040641);
      // 0.00040641 BTC x 250000 = 101.6025, rounded to the 2 decimals of the base currency.
      expect(created!.refAmount).toBe(101.6);

      const fetched = await readTx({ id: created!.id });
      expect(fetched.amount).toBe(0.00040641);
      expect(fetched.refAmount).toBe(101.6);
      expect(fetched.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });
    });

    it('rounds an amount with more than 8 decimals to 8 and stores it', async () => {
      await createCurrency({ code: 'BTC', decimals: 8, rate: 250000 });
      const account = await createAccountIn({ code: 'BTC' });

      const [created] = await createTx({ accountId: account.id, amount: 0.123456789 });

      expect(created!.amount).toBe(0.12345679);
    });

    it('stores 6 decimals of USDT exactly and keeps them in the account balance', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 3.6725 });
      const account = await createAccountIn({ code: 'USDT' });

      const [created] = await createTx({ accountId: account.id, amount: 12.345678, type: TRANSACTION_TYPES.income });

      expect(created!.amount).toBe(12.345678);
      // 12.345678 x 3.6725 = 45.339502455, rounded to the base currency.
      expect(created!.refAmount).toBe(45.34);

      expect((await readTx({ id: created!.id })).amount).toBe(12.345678);
      const reloaded = await readAccount({ id: account.id });
      expect(reloaded.currentBalance).toBe(12.345678);
      expect(reloaded.refCurrentBalance).toBe(45.34);
    });
  });

  describe('conversion path', () => {
    it('crosses the stored quote into the base currency with the manual ISO rate of that quote', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      // USDT keeps its rate in USD; the user's own USD to base rate then decides the value.
      await createCurrency({ code: 'USDT', decimals: 6, rate: 1, quote: 'USD' });
      await setRates(pairRates({ code: 'USD', rate: 3.9 }));
      const account = await createAccountIn({ code: 'USDT' });

      const [created] = await createTx({ accountId: account.id, amount: 10 });

      expect(created!.refAmount).toBe(39);
    });

    it('values later entries through the same stored quote after the ISO rate changes', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 1, quote: 'USD' });
      await setRates(pairRates({ code: 'USD', rate: 3.9 }));
      const account = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: account.id, amount: 10 });

      await setRates(pairRates({ code: 'USD', rate: 4 }));
      const [second] = await createTx({ accountId: account.id, amount: 10 });

      expect(first!.refAmount).toBe(39);
      expect(second!.refAmount).toBe(40);
    });
  });

  describe('transfers', () => {
    it('values both legs of a USDT to USD transfer when both amounts are given', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 3.6725 });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await setRates(pairRates({ code: 'USD', rate: 4 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: 'USD' });

      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 100.123456,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: usd.id as RecordId,
          destinationAmount: 27.5,
        },
      });

      expect(source!.amount).toBe(100.123456);
      // 100.123456 x 3.6725 = 367.7... rounded to 2 decimals
      expect(source!.refAmount).toBe(367.7);
      expect(destination!.amount).toBe(27.5);
      expect(destination!.refAmount).toBe(110);
    });

    it('takes the base-currency value from the base-currency leg when the other leg is custom', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 3.6725 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const base = await createAccountIn({ code: BASE(), name: 'Base' });

      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 10,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: base.id as RecordId,
          destinationAmount: 36.7,
        },
      });

      expect(source!.refAmount).toBe(36.7);
      expect(destination!.refAmount).toBe(36.7);
    });
  });

  describe('the rate of a custom currency', () => {
    it('re-values an entry saved again after the rate changes', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [custom] = await createTx({ accountId: usdt.id, amount: 5 });
      expect(custom!.refAmount).toBe(20);

      await setRates(pairRates({ code: 'USDT', rate: 3.6725 }));
      const [updated] = (await helpers.updateTransaction({
        id: custom!.id as RecordId,
        payload: { amount: 6 },
        raw: true,
      })) as unknown as TransactionApiResponse[];

      expect(updated!.refAmount).toBe(22.04);
      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBe(-22.04);
    });

    it('rejects a rate between two custom currencies with 422', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, rate: 2 });
      await createCurrency({ code: 'COIN', decimals: 4, rate: 5 });

      const response = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'SAT', rate: 3, quote: 'COIN' }),
      });

      expect(response.statusCode).toBe(422);
      const sat = await createAccountIn({ code: 'SAT' });
      const [created] = await createTx({ accountId: sat.id, amount: 0.5 });
      expect(created!.refAmount).toBe(1);
    });

    it('refuses to remove the last rate of a custom currency with 422 and keeps valuing it', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });

      const today = new Date().toISOString().slice(0, 10);
      const response = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: BASE(), effectiveDate: today },
          { baseCode: BASE(), quoteCode: 'USDT', effectiveDate: today },
        ],
      });

      expect(response.statusCode).toBe(422);
      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 5 });
      expect(created!.refAmount).toBe(20);
    });

    it("answers a removal naming another user's custom code exactly like one naming an unknown code", async () => {
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({ cookies: bob.cookies, fn: () => createCurrency({ code: 'SAT', decimals: 8, rate: 2 }) });

      const removeBothWays = (code: string) =>
        helpers.removeCurrencyExchangeRate({
          pairs: [
            { baseCode: code, quoteCode: BASE() },
            { baseCode: BASE(), quoteCode: code },
          ],
        });
      const hidden = await removeBothWays('SAT');
      const unknown = await removeBothWays('NOPE');

      expect(hidden.statusCode).toBe(422);
      expect(unknown.statusCode).toBe(422);
      expect(messageOf(hidden)).toBe(messageOf(unknown).replaceAll('NOPE', 'SAT'));
    });

    it("re-quotes a custom currency's rate of the day in another ISO currency, keeping live rates on it", async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });
      await setRates([...pairRates({ code: 'USDT', rate: 1, quote: 'USD' }), ...pairRates({ code: 'USD', rate: 3.9 })]);

      const { id: userId } = await helpers.getUserInfo({ raw: true });
      const usdtRates = await UserExchangeRates.findAll({ where: { userId }, raw: true });
      expect(
        usdtRates
          .filter((row) => row.baseCode === 'USDT' || row.quoteCode === 'USDT')
          .map(({ baseCode, quoteCode }) => `${baseCode}>${quoteCode}`)
          .toSorted(),
      ).toEqual(['USDT>USD']);

      // The rate of the day is also its last rate.
      const today = new Date().toISOString().slice(0, 10);
      const removal = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: 'USD', effectiveDate: today },
          { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: today },
        ],
      });
      expect(removal.statusCode).toBe(422);

      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 10 });
      expect(created!.refAmount).toBe(39);
    });

    it('keeps the last of a pair repeated in one request', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });

      const response = await helpers.editCurrencyExchangeRate({
        pairs: [...pairRates({ code: 'USDT', rate: 5 }), ...pairRates({ code: 'USDT', rate: 6 })],
      });
      expect(response.statusCode).toBe(200);

      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 10 });
      expect(created!.refAmount).toBe(60);
    });

    it('leaves live rates on the ISO quote when only the custom rate is edited', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 1, quote: 'USD' });
      const usdBefore = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'USD');
      expect(usdBefore!.liveRateUpdate).toBe(true);

      const response = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'USDT', rate: 1.01, quote: 'USD' }),
      });

      expect(response.statusCode).toBe(200);
      const usd = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'USD');
      expect(usd!.liveRateUpdate).toBe(true);
    });

    it('rejects one request that quotes a custom currency in two ISO currencies', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });

      const response = await helpers.editCurrencyExchangeRate({
        pairs: [...pairRates({ code: 'USDT', rate: 1, quote: 'USD' }), ...pairRates({ code: 'USDT', rate: 4 })],
      });

      expect(response.statusCode).toBe(422);
    });

    it('rejects a quote in an ISO currency the user does not hold', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });

      const response = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'USDT', rate: 1, quote: 'JPY' }),
      });

      expect(response.statusCode).toBe(422);
    });

    it('refuses live rates or a flat rate on a custom holding through the ISO currency endpoint', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4 });

      const response = await helpers.updateUserCurrency({
        currency: { currencyCode: 'USDT', liveRateUpdate: true },
      });

      expect(response.statusCode).toBe(422);
      const usdt = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'USDT');
      expect(usdt!.liveRateUpdate).toBe(false);
    });

    it('refuses to remove the ISO currency a custom currency is quoted in, naming it as the blocker', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 1, quote: 'USD', name: 'Tether' });

      const blocked = await helpers.deleteUserCurrency<helpers.ErrorResponse>({ currencyCode: 'USD' });
      expect(blocked.statusCode).toBe(422);
      const error = helpers.extractResponse(blocked);
      expect(error.code).toBe(API_ERROR_CODES.currencyInUse);
      expect(error.details).toEqual({ blockers: [{ type: 'customCurrency', id: 'USDT', name: 'Tether' }] });

      await setRates(pairRates({ code: 'USDT', rate: 4 }));
      expect((await helpers.deleteUserCurrency({ currencyCode: 'USD' })).statusCode).toBe(200);
    });

    it('refuses to remove the ISO currency a custom currency is pegged to, naming it as the blocker', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'USDT', decimals: 6, rate: 4, name: 'Tether' });
      await helpers.pegTo({ code: 'USDT', pegCurrency: 'USD' });

      const blocked = await helpers.deleteUserCurrency<helpers.ErrorResponse>({ currencyCode: 'USD' });

      expect(blocked.statusCode).toBe(422);
      expect(helpers.extractResponse(blocked).details).toEqual({
        blockers: [{ type: 'customCurrency', id: 'USDT', name: 'Tether' }],
      });
    });
  });

  describe('two users with their own definition of the same code', () => {
    it('values the same entry differently according to each user decimals', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, name: 'Satoshi', rate: 3 });
      const aliceAccount = await createAccountIn({ code: 'SAT' });
      const [aliceTx] = await createTx({ accountId: aliceAccount.id, amount: 1.5 });
      const [aliceOther] = await createTx({ accountId: aliceAccount.id, amount: 2.4 });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await createCurrency({ code: 'SAT', decimals: 0, name: 'Sats', rate: 3 });
          const bobAccount = await createAccountIn({ code: 'SAT' });
          const [bobTx] = await createTx({ accountId: bobAccount.id, amount: 1.5, ownCategory: true });
          const [bobOther] = await createTx({ accountId: bobAccount.id, amount: 2.4, ownCategory: true });

          // Half rounds up to 2 whole sats for Bob.
          expect(bobTx!.amount).toBe(2);
          expect(bobTx!.refAmount).toBe(6);
          expect(bobOther!.amount).toBe(2);
          expect(bobOther!.refAmount).toBe(6);
        },
      });

      expect(aliceTx!.amount).toBe(1.5);
      expect(aliceTx!.refAmount).toBe(4.5);
      expect(aliceOther!.amount).toBe(2.4);
      expect(aliceOther!.refAmount).toBe(7.2);
    });
  });

  describe('a collaborator who never defined the currency', () => {
    it("connects the code with the owner's definition and rate, never another user's", async () => {
      // Carol defines SAT first, so the shared global row exists before Alice's definition.
      const carol = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: carol.cookies,
        fn: () => createCurrency({ code: 'SAT', decimals: 2, name: 'Carol Sats', symbol: 'c', rate: 7 }),
      });

      await createCurrency({ code: 'SAT', decimals: 6, name: 'Satoshi', rate: 3 });
      const account = await createAccountIn({ code: 'SAT', name: 'Shared SAT' });

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
          expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);

          const [created] = await createTx({ accountId: account.id, amount: 0.123456789 });

          // Alice's 6 decimals govern the amount, and her rate (copied to Bob) values it: 0.123457 x 3.
          expect(created!.amount).toBe(0.123457);
          expect(created!.refAmount).toBe(0.37);
          expect(created!.currencyMeta).toEqual({ decimals: 6, symbol: null, isCustom: true });

          const connected = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'SAT');
          expect(connected).toBeDefined();
          expect(connected!.currency).toMatchObject({ code: 'SAT', digits: 6, currency: 'Satoshi', symbol: null });
          expect(connected!.liveRateUpdate).toBe(false);

          const sharedAccount = (await helpers.getAccounts()).find(
            (candidate) => candidate.id === account.id,
          ) as unknown as AccountApiResponse | undefined;
          expect(sharedAccount?.currencyMeta).toEqual({ decimals: 6, symbol: null, isCustom: true });
        },
      });
    });

    /** Alice's SAT account (6 decimals) shared with write access to a second user who accepted it. */
    const shareSatAccountWithBob = async () => {
      await createCurrency({ code: 'SAT', decimals: 6, rate: 3 });
      const account = await createAccountIn({ code: 'SAT', name: 'Shared SAT' });

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
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      return { account, bob };
    };

    it('connects the code once when two first writes on the shared account race', async () => {
      const { account, bob } = await shareSatAccountWithBob();

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await Promise.all([
            createTx({ accountId: account.id, amount: 1 }),
            createTx({ accountId: account.id, amount: 2 }),
          ]);

          const holdings = (await helpers.getUserCurrencies()).filter((item) => item.currencyCode === 'SAT');
          expect(holdings).toHaveLength(1);
        },
      });
    });

    it("values a collaborator's write with the owner's peg, which the collaborator's holding takes", async () => {
      const { account, bob } = await shareSatAccountWithBob();
      await helpers.pegTo({ code: 'SAT', pegCurrency: BASE(), factor: 2 });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const [created] = await createTx({ accountId: account.id, amount: 10 });

          expect(created!.refAmount).toBe(20);
          expect(await helpers.savedSource({ code: 'SAT' })).toEqual({
            rateSource: 'peg',
            rateSourceConfig: { pegCurrency: BASE(), factor: 2 },
          });
        },
      });
    });

    it("rounds a transfer into the shared account with the owner's decimals, on create and on edit", async () => {
      const { account, bob } = await shareSatAccountWithBob();

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const own = await createAccountIn({ code: BASE(), name: 'Bob base' });
          const [source, destination] = await createTx({
            accountId: own.id,
            amount: 10,
            ownCategory: true,
            extra: {
              transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
              destinationAccountId: account.id as RecordId,
              destinationAmount: 0.123456789,
            },
          });
          expect(destination!.amount).toBe(0.123457);

          const [, edited] = await helpers.updateTransaction({
            id: source!.id as RecordId,
            payload: { destinationAmount: 0.987654321 },
            raw: true,
          });
          expect(edited!.id).toBe(destination!.id);
          expect(Number(edited!.amount)).toBe(0.987654);

          expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);
        },
      });
    });

    it('connects the code when editing an owner row is the first write', async () => {
      const { account, bob } = await shareSatAccountWithBob();
      const [aliceTx] = await createTx({ accountId: account.id, amount: 1 });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          const response = await helpers.updateTransaction({
            id: aliceTx!.id as RecordId,
            payload: { amount: 0.123456789 },
          });
          expect(response.statusCode).toBe(200);
          const [edited] = helpers.extractResponse(response as helpers.CustomResponse<TransactionApiResponse[]>);

          expect(Number(edited!.amount)).toBe(0.123457);
          expect(edited!.refAmount).toBe(0.37);

          const holdings = (await helpers.getUserCurrencies()).filter((item) => item.currencyCode === 'SAT');
          expect(holdings).toHaveLength(1);
        },
      });
    });

    it("rounds the splits a collaborator writes with the owner's decimals", async () => {
      const { account, bob } = await shareSatAccountWithBob();
      const [mainCategory, splitCategory] = await helpers.getCategoriesList();

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await createTx({
            accountId: account.id,
            amount: 1,
            extra: {
              categoryId: mainCategory!.id,
              splits: [{ categoryId: splitCategory!.id, amount: 0.123456789 }],
            },
          });

          const [withSplits] = await helpers.getTransactions({ accountIds: [account.id as RecordId], raw: true });
          expect(withSplits!.splits![0]!.amount).toBe(0.123457);
        },
      });
    });

    it("prices a collaborator's write through the owner's quote and adds a holding of that quote", async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await createCurrency({ code: 'SAT', decimals: 6, rate: 2, quote: 'USD' });
      const account = await createAccountIn({ code: 'SAT', name: 'Shared SAT' });
      const usd = await createAccountIn({ code: 'USD' });
      const [usdTx] = await createTx({ accountId: usd.id, amount: 20 });

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

          const [created] = await createTx({ accountId: account.id, amount: 10 });

          // 10 SAT at 2 USD each is worth what 20 USD is, at the same market rate.
          expect(created!.refAmount).toBe(usdTx!.refAmount);
          expect((await helpers.getUserCurrencies()).map((item) => item.currencyCode)).toContain('USD');
        },
      });
    });

    it("rounds a foreign amount the owner sets on a collaborator's row with the owner's definition", async () => {
      await createCurrency({ code: 'COIN', decimals: 4, rate: 5 });
      const account = await createAccountIn({ code: BASE(), name: 'Shared base' });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: bob.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.write,
        policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
        raw: true,
      });
      const [bobTx] = await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
          return createTx({ accountId: account.id, amount: 1 });
        },
      });

      // Bob never defined COIN, so only the caller's definition can round it.
      const response = await helpers.updateTransaction({
        id: bobTx!.id as RecordId,
        payload: { originalAmount: 1.23456, originalCurrencyCode: 'COIN' },
      });

      expect(response.statusCode).toBe(200);
      expect((await readTx({ id: bobTx!.id })).originalAmount).toBe(1.2346);
    });
  });

  describe('backup and restore', () => {
    beforeEach(async () => {
      const { id } = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
      await RateLimitService.resetRateLimit(`backup:user:${id}`);
      await RateLimitService.resetRateLimit(`backup-restore:user:${id}`);
    });

    it('restores a custom-currency transaction with its base-currency value and the rate behind it', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 4 });
      const usdt = await createAccountIn({ code: 'USDT', name: 'Stable' });
      await createTx({ accountId: usdt.id, amount: 5.123456 });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);

      await helpers.wipeUserData();
      const restore = await helpers.restoreBackup({ fileContent: exported.body.toString('base64') });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      const restoredAccount = (await helpers.getAccounts()).find((candidate) => candidate.name === 'Stable');
      expect(restoredAccount).toBeDefined();
      const restored = (await helpers.getTransactions({
        accountIds: [restoredAccount!.id as RecordId],
        raw: true,
      })) as unknown as TransactionApiResponse[];

      expect(restored).toHaveLength(1);
      expect(restored[0]!.amount).toBe(5.123456);
      expect(restored[0]!.refAmount).toBe(20.49);

      const [later] = await createTx({ accountId: restoredAccount!.id, amount: 1 });
      expect(later!.refAmount).toBe(4);
    });

    it('refuses with 422 an archive whose custom currency has no rate', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 4 });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const rates = archive.readData({ name: 'user-exchange-rates' }) as { baseCode: string; quoteCode: string }[];
      archive.files.set(
        'data/user-exchange-rates.json',
        Buffer.from(JSON.stringify(rates.filter((row) => row.baseCode !== 'USDT' && row.quoteCode !== 'USDT'))),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(await helpers.listCustomCurrencies({ raw: true })).toHaveLength(1);
    });

    it('restores an archive whose custom currency also has rates in a second ISO currency', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 4 });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const rates = archive.readData({ name: 'user-exchange-rates' }) as Record<string, unknown>[];
      archive.files.set(
        'data/user-exchange-rates.json',
        Buffer.from(
          JSON.stringify([...rates, { ...rates.find((row) => row.baseCode === 'USDT')!, quoteCode: 'JPY', rate: 500 }]),
        ),
      );

      await helpers.wipeUserData();
      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });
      expect(restore.statusCode).toBe(200);
      expect((await helpers.waitForRestore({ jobId: restore.jobId! })).status).toBe('completed');

      const held = (await helpers.getUserCurrencies()).map((row) => row.currencyCode);
      expect(held).toEqual(expect.arrayContaining(['USDT', 'JPY']));
    });

    it.each([
      {
        name: 'is quoted in a code that is not ISO here',
        tamper: (rows: Record<string, unknown>[]) =>
          rows.map((row) =>
            row.baseCode === 'USDT'
              ? { ...row, quoteCode: 'NOPE' }
              : row.quoteCode === 'USDT'
                ? { ...row, baseCode: 'NOPE' }
                : row,
          ),
      },
      {
        name: 'has no positive rate',
        tamper: (rows: Record<string, unknown>[]) =>
          rows.map((row) => (row.baseCode === 'USDT' ? { ...row, rate: 0 } : row)),
      },
    ])('refuses with 422 an archive whose custom currency $name', async ({ tamper }) => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 4 });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const rates = archive.readData({ name: 'user-exchange-rates' }) as Record<string, unknown>[];
      archive.files.set('data/user-exchange-rates.json', Buffer.from(JSON.stringify(tamper(rates))));

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toContain('"USDT"');
    });

    it('adds a holding of the ISO quote when the archive does not hold it', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether', rate: 4 });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const rates = archive.readData({ name: 'user-exchange-rates' }) as Record<string, unknown>[];
      const requoted = rates.map((row) =>
        row.baseCode === 'USDT'
          ? { ...row, quoteCode: 'JPY' }
          : row.quoteCode === 'USDT'
            ? { ...row, baseCode: 'JPY' }
            : row,
      );
      archive.files.set('data/user-exchange-rates.json', Buffer.from(JSON.stringify(requoted)));

      await helpers.wipeUserData();
      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });
      expect(restore.statusCode).toBe(200);
      expect((await helpers.waitForRestore({ jobId: restore.jobId! })).status).toBe('completed');

      const held = (await helpers.getUserCurrencies()).map((row) => row.currencyCode);
      expect(held).toEqual(expect.arrayContaining(['USDT', 'JPY']));
    });

    it('refuses with 422 an archive that holds a rate between two custom currencies', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, rate: 2 });
      await createCurrency({ code: 'COIN', decimals: 4, rate: 5 });
      const editRefusal = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'SAT', rate: 3, quote: 'COIN' }),
      });
      expect(editRefusal.statusCode).toBe(422);

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const rates = archive.readData({ name: 'user-exchange-rates' }) as Record<string, unknown>[];
      const satRate = rates.find((row) => row.baseCode === 'SAT' && row.quoteCode === BASE())!;
      archive.files.set(
        'data/user-exchange-rates.json',
        Buffer.from(JSON.stringify([...rates, { ...satRate, quoteCode: 'COIN', rate: 0.4 }])),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toBe(messageOf(editRefusal));
    });

    it('refuses with 422 an archive whose base currency is a custom currency', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, rate: 2 });

      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const holdings = archive.readData({ name: 'users-currencies' }) as Record<string, unknown>[];
      archive.files.set(
        'data/users-currencies.json',
        Buffer.from(JSON.stringify(holdings.map((row) => ({ ...row, isDefaultCurrency: row.currencyCode === 'SAT' })))),
      );

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files: archive.files }),
      });

      expect(restore.statusCode).toBe(422);
      expect(restore.message).toContain('"SAT" is a custom currency and cannot be the base currency');
    });
  });
});
