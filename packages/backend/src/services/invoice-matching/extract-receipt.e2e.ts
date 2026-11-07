import { ACCOUNT_TYPES, AI_FEATURE, FEATURES, FEATURE_TRIAL_LIMITS, PLANS, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createFirstConnection } from '@tests/helpers/user-settings';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { getCustomEndpointContentMock } from '@tests/mocks/openai-compatible/mock-api';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const receiptAnswer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    isInvoice: true,
    vendorName: 'Corner Bakery',
    customerName: null,
    totalAmount: 12.5,
    currencyCode: 'EUR',
    issueDate: '2026-06-10',
    invoiceNumber: 'R-77',
    invoiceUrl: null,
    issueTime: '13:14',
    payeeName: null,
    categoryName: null,
    ...overrides,
  });

const notAReceiptAnswer = JSON.stringify({
  isInvoice: false,
  vendorName: null,
  customerName: null,
  totalAmount: null,
  currencyCode: null,
  issueDate: null,
  invoiceNumber: null,
  invoiceUrl: null,
  issueTime: null,
  payeeName: null,
  categoryName: null,
});

describe('POST /transactions/extract-receipt', () => {
  describe('with a user-owned AI connection', () => {
    useSelfHostWithoutServerAiKeys();

    it('returns the receipt fields as decimals', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: receiptAnswer() }));

      const result = await helpers.extractReceipt({ file: JPEG_BYTES, transactionType: TRANSACTION_TYPES.income });

      expect(result.statusCode).toBe(200);
      expect(result.response!.suggestedAccountId).toBeNull();
      expect(result.response!.suggestedPayeeId).toBeNull();
      expect(result.response!.suggestedCategoryId).toBeNull();
      expect(result.response!.issueTime).toBe('13:14');
      expect(result.response!.invoice).toEqual({
        transactionType: TRANSACTION_TYPES.income,
        vendorName: 'Corner Bakery',
        customerName: null,
        totalAmount: 12.5,
        currencyCode: 'EUR',
        issueDate: '2026-06-10',
        invoiceNumber: 'R-77',
        invoiceUrl: null,
      });
    });

    it('suggests a manual account in the receipt currency even when unused, then the most used one', async () => {
      await createFirstConnection();
      const foreignCode = 'UAH';
      await helpers.addUserCurrencies({ currencyCodes: [foreignCode] });
      const busyBase = await helpers.createAccount({ raw: true });
      const foreign = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: foreignCode }),
        raw: true,
      });
      for (const accountId of [busyBase.id, busyBase.id]) {
        await helpers.createTransaction({ payload: helpers.buildTransactionPayload({ accountId }) });
      }

      global.mswMockServer.use(getCustomEndpointContentMock({ content: receiptAnswer({ currencyCode: foreignCode }) }));
      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedAccountId).toBe(foreign.id);

      global.mswMockServer.use(getCustomEndpointContentMock({ content: receiptAnswer({ currencyCode: 'SEK' }) }));
      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedAccountId).toBe(busyBase.id);

      await Accounts.update({ type: ACCOUNT_TYPES.monobank }, { where: { id: busyBase.id } });
      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedAccountId).toBe(foreign.id);
    });

    it('suggests the known payee the AI picked, case-insensitively, and drops a time that is not one', async () => {
      await createFirstConnection();
      const payee = await helpers.createPayee({ payload: { name: 'BP' }, raw: true });
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: receiptAnswer({ payeeName: 'bp', issueTime: '25:99' }) }),
      );

      const result = await helpers.extractReceipt({ file: JPEG_BYTES });

      expect(result.response!.suggestedPayeeId).toBe(payee.id);
      expect(result.response!.issueTime).toBeNull();
    });

    it('suggests the manual account the payee is paid from over one in the receipt currency', async () => {
      await createFirstConnection();
      await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });
      const payee = await helpers.createPayee({ payload: { name: 'BP' }, raw: true });
      await helpers.createPayeeAlias({ payeeId: payee.id, rawName: 'BP EUROPA SE' });
      const paidFrom = await helpers.createAccount({ raw: true });
      const inCurrency = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'UAH' }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: paidFrom.id, payeeId: payee.id }),
      });
      for (let i = 0; i < 3; i++) {
        await helpers.createTransaction({ payload: helpers.buildTransactionPayload({ accountId: inCurrency.id }) });
      }
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: receiptAnswer({ payeeName: 'BP EUROPA SE', currencyCode: 'UAH' }) }),
      );

      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedAccountId).toBe(paidFrom.id);
    });

    it("suggests the AI's category when no matched payee carries a default", async () => {
      await createFirstConnection();
      const car = await helpers.addCustomCategory({ name: 'Car', color: '#111111', raw: true });
      const fuel = await helpers.addCustomCategory({ name: 'Fuel', color: '#222222', parentId: car.id, raw: true });
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: receiptAnswer({ categoryName: 'car › fuel' }) }),
      );

      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedCategoryId).toBe(fuel.id);
    });

    it("prefers the matched payee's default category over the AI's pick", async () => {
      await createFirstConnection();
      const fuel = await helpers.addCustomCategory({ name: 'Fuel', color: '#222222', raw: true });
      await helpers.addCustomCategory({ name: 'Food', color: '#333333', raw: true });
      await helpers.createPayee({ payload: { name: 'BP', defaultCategoryId: fuel.id }, raw: true });
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: receiptAnswer({ payeeName: 'BP', categoryName: 'Food' }) }),
      );

      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedCategoryId).toBe(fuel.id);
    });

    it('suggests no payee when the AI names one the user does not have', async () => {
      await createFirstConnection();
      await helpers.createPayee({ payload: { name: 'BP' }, raw: true });
      global.mswMockServer.use(getCustomEndpointContentMock({ content: receiptAnswer({ payeeName: 'Shell' }) }));

      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).response!.suggestedPayeeId).toBeNull();
    });

    it('rejects a photo the AI does not recognise as a receipt', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: notAReceiptAnswer }));

      const result = await helpers.extractReceipt({ file: JPEG_BYTES });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/invoice or a receipt/i);
    });

    it('rejects an empty body', async () => {
      const result = await helpers.extractReceipt({ file: Buffer.alloc(0) });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/no file/i);
    });
  });

  describe('free-try trial', () => {
    let serverKeyBeforeTest: string | undefined;

    beforeEach(() => {
      serverKeyBeforeTest = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
    });

    afterEach(() => {
      if (serverKeyBeforeTest === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = serverKeyBeforeTest;
    });

    it('spends the invoice-matching free tries and 402s once they are gone', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });
      global.mswMockServer.use(
        createGeminiMock({
          rawText: receiptAnswer(),
          expectedModel: FALLBACK_SERVER_MODELS[AI_FEATURE.receiptParsing].model,
        }),
      );

      const limit = FEATURE_TRIAL_LIMITS[FEATURES.invoice_matching]!;
      for (let attempt = 0; attempt < limit; attempt++) {
        expect((await helpers.extractReceipt({ file: JPEG_BYTES })).statusCode).toBe(200);
      }

      expect((await helpers.extractReceipt({ file: JPEG_BYTES })).statusCode).toBe(402);
      expect((await helpers.matchInvoice({ file: JPEG_BYTES })).statusCode).toBe(402);
    });
  });
});
