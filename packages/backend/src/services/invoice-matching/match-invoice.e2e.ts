import {
  AI_FEATURE,
  FEATURES,
  FEATURE_TRIAL_LIMITS,
  PLANS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import { STATEMENT_PDF_FIXTURES, readStatementPdfFixture } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createFirstConnection } from '@tests/helpers/user-settings';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import {
  CUSTOM_ENDPOINT_MODEL,
  getCustomEndpointContentMock,
  getCustomEndpointUnsupportedInputMock,
  getCustomEndpointVllmMock,
} from '@tests/mocks/openai-compatible/mock-api';
import fs from 'node:fs';
import path from 'node:path';

/** Smallest valid 1x1 PNG; the endpoint identifies the upload by its magic bytes. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const TEXT_INVOICE_PDF = fs.readFileSync(
  path.resolve(__dirname, '../../tests/fixtures/invoice-matching/text-invoice.pdf'),
);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>', 'utf8');

const VENDOR_NAME = 'Acme Cloud Services';
const CUSTOMER_NAME = 'Northwind Studio';
const ISSUE_DATE = '2026-06-10';
const PAYMENT_TIME = `${ISSUE_DATE}T12:00:00.000Z`;
const INVOICE_DECIMAL = 123.45;

const invoiceAnswer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    isInvoice: true,
    vendorName: VENDOR_NAME,
    customerName: CUSTOMER_NAME,
    totalAmount: INVOICE_DECIMAL,
    currencyCode: global.BASE_CURRENCY_CODE,
    issueDate: ISSUE_DATE,
    invoiceNumber: 'INV-2026-0042',
    invoiceUrl: 'https://acme.test/invoices/42',
    ...overrides,
  });

const notAnInvoiceAnswer = JSON.stringify({
  isInvoice: false,
  vendorName: null,
  customerName: null,
  totalAmount: null,
  currencyCode: null,
  issueDate: null,
  invoiceNumber: null,
  invoiceUrl: null,
});

const correctedInvoice = (overrides: Record<string, unknown> = {}) => ({
  transactionType: TRANSACTION_TYPES.expense,
  vendorName: VENDOR_NAME,
  customerName: null,
  totalAmount: INVOICE_DECIMAL,
  currencyCode: global.BASE_CURRENCY_CODE,
  issueDate: ISSUE_DATE,
  invoiceNumber: null,
  invoiceUrl: null,
  ...overrides,
});

const mockAiAnswer = ({ content }: { content: string }) => {
  global.mswMockServer.use(getCustomEndpointContentMock({ content }));
};

/** The model the server key runs for receipt parsing, which is what a trial upload dials. */
const OPERATOR_MODEL_NAME = FALLBACK_SERVER_MODELS[AI_FEATURE.receiptParsing].model;

const TRIAL_LIMIT = FEATURE_TRIAL_LIMITS[FEATURES.invoice_matching]!;

const mockOperatorAnswer = ({ content }: { content: string }) => {
  global.mswMockServer.use(createGeminiMock({ rawText: content, expectedModel: OPERATOR_MODEL_NAME }));
};

const usedTries = async (): Promise<number> =>
  (await helpers.getUserInfo({ raw: true })).entitlements!.trialUsage[FEATURES.invoice_matching] ?? 0;

describe('Invoice matching', () => {
  describe('POST /transactions/match-invoice', () => {
    useSelfHostWithoutServerAiKeys();

    it('returns the paying transaction first, with its signals and external fields', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer() });

      const account = await helpers.createAccount({ raw: true });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          note: 'ACME CLOUD SERVICES',
          externalReference: 'REF-9001',
          externalUrl: 'https://bank.test/tx/9001',
          originalAmount: 30,
          originalCurrencyCode: 'USD',
        }),
        raw: true,
      });
      const [decoy] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 120,
          time: PAYMENT_TIME,
          note: 'Corner bakery',
        }),
        raw: true,
      });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice).toEqual({
        transactionType: TRANSACTION_TYPES.expense,
        vendorName: VENDOR_NAME,
        customerName: CUSTOMER_NAME,
        totalAmount: INVOICE_DECIMAL,
        currencyCode: global.BASE_CURRENCY_CODE,
        issueDate: ISSUE_DATE,
        invoiceNumber: 'INV-2026-0042',
        invoiceUrl: 'https://acme.test/invoices/42',
      });

      const candidates = result.response!.candidates;
      expect(candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id, decoy!.id]);
      expect(candidates[0]!.score).toBeGreaterThan(candidates[1]!.score);
      expect(candidates[0]!.signals).toEqual({
        amount: 'exact',
        amountDiff: null,
        daysFromInvoice: 0,
        merchant: 'match',
      });

      expect(candidates[0]!.transaction).toMatchObject({
        amount: INVOICE_DECIMAL,
        externalReference: 'REF-9001',
        externalUrl: 'https://bank.test/tx/9001',
        originalAmount: 30,
        originalCurrencyCode: 'USD',
      });
    });

    it('matches an issued invoice against income, by the customer who paid it', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer() });

      const account = await helpers.createAccount({ raw: true });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          transactionType: TRANSACTION_TYPES.income,
          note: 'NORTHWIND STUDIO INV-2026-0042',
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          note: 'ACME CLOUD SERVICES',
        }),
        raw: true,
      });

      const result = await helpers.matchInvoice({ file: PNG_BYTES, transactionType: TRANSACTION_TYPES.income });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
      expect(result.response!.candidates[0]!.signals.merchant).toBe('match');
    });

    it('rejects a transaction type that is neither income nor expense', async () => {
      await createFirstConnection();

      const result = await helpers.matchInvoice({ file: PNG_BYTES, transactionType: 'transfer' });

      expect(result.statusCode).toBe(422);
    });

    it('returns the invoice with no candidates when nothing could have paid it', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer() });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(200);
      expect(result.response!.candidates).toEqual([]);
      expect(result.response!.invoice.vendorName).toBe(VENDOR_NAME);
    });

    it('drops a printed link that leads to a generic page rather than this invoice', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer({ invoiceUrl: 'https://www.fotokoch.de/mybestellstatus.html' }) });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.invoiceUrl).toBeNull();
    });

    it('reads an empty invoice number as none at all', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer({ invoiceNumber: '' }) });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.invoiceNumber).toBeNull();
    });

    it('rejects an upload sent as anything but raw bytes', async () => {
      await createFirstConnection();

      const result = await helpers.matchInvoice({ file: PNG_BYTES, contentType: 'image/png' });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/no file/i);
    });

    it('rejects an empty body', async () => {
      await createFirstConnection();

      const result = await helpers.matchInvoice({ file: Buffer.alloc(0) });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/no file/i);
    });

    it('rejects a file type the AI cannot read', async () => {
      await createFirstConnection();

      const result = await helpers.matchInvoice({ file: SVG_BYTES });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/unsupported file type/i);
    });

    it('rejects a document the AI does not recognise as an invoice', async () => {
      await createFirstConnection();
      mockAiAnswer({ content: notAnInvoiceAnswer });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/invoice or a receipt/i);
    });

    it('names the model and keeps its connection usable when the model cannot read the file', async () => {
      const connection = await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointUnsupportedInputMock());

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toContain(CUSTOM_ENDPOINT_MODEL);
      expect(result.errorMessage).toMatch(/no endpoints found that support image input/i);
      const connections = await helpers.getAiConnections({ raw: true });
      expect(connections.find(({ id }) => id === connection.id)).toMatchObject({ status: 'valid' });
    });

    it('reads a PDF through an OpenAI-compatible endpoint that takes no file parts', async () => {
      await createFirstConnection();
      const bodies: string[] = [];
      global.mswMockServer.use(
        getCustomEndpointVllmMock({ content: invoiceAnswer(), onBody: (body) => bodies.push(body) }),
      );

      const result = await helpers.matchInvoice({ file: TEXT_INVOICE_PDF });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.vendorName).toBe(VENDOR_NAME);
      expect(bodies.join('')).toContain('Acme Cloud Services billed to Northwind Studio');
    });

    it('sends a scanned PDF to an OpenAI-compatible endpoint as page images', async () => {
      await createFirstConnection();
      const bodies: string[] = [];
      global.mswMockServer.use(
        getCustomEndpointVllmMock({ content: invoiceAnswer(), onBody: (body) => bodies.push(body) }),
      );

      const result = await helpers.matchInvoice({
        file: readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.noTextLayer }),
      });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.vendorName).toBe(VENDOR_NAME);
      expect(bodies.join('')).toContain('data:image/png;base64,');
    });

    it('asks for an image when a PDF sent to an OpenAI-compatible endpoint is password-protected', async () => {
      await createFirstConnection();
      let calls = 0;
      global.mswMockServer.use(getCustomEndpointVllmMock({ content: invoiceAnswer(), onBody: () => calls++ }));

      const result = await helpers.matchInvoice({
        file: readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.encrypted }),
      });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/image/i);
      expect(calls).toBe(0);
    });

    it.each(['http://acme.test/42', 'javascript:alert(1)'])('drops the invoice link when it is %s', async (link) => {
      await createFirstConnection();
      mockAiAnswer({ content: invoiceAnswer({ invoiceUrl: link }) });

      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice.invoiceUrl).toBeNull();
    });

    it('tells a user with no AI configured to set a provider up', async () => {
      const result = await helpers.matchInvoice({ file: PNG_BYTES });

      expect(result.statusCode).toBe(422);
      expect(result.errorMessage).toMatch(/no ai model configured/i);
    });
  });

  describe('POST /transactions/match-invoice/candidates', () => {
    it('ranks candidates for corrected invoice fields without any AI configured', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          note: 'ACME CLOUD SERVICES',
        }),
        raw: true,
      });

      const result = await helpers.rematchInvoice({ invoice: correctedInvoice() });

      expect(result.statusCode).toBe(200);
      expect(result.response!.invoice).toEqual(correctedInvoice());
      expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
      expect(result.response!.candidates[0]!.signals.amount).toBe('exact');
    });

    it('searches income once the corrected invoice is flipped to one the user issued', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          transactionType: TRANSACTION_TYPES.income,
          note: 'NORTHWIND STUDIO',
        }),
        raw: true,
      });

      const asExpense = await helpers.rematchInvoice({ invoice: correctedInvoice() });
      const asIncome = await helpers.rematchInvoice({
        invoice: correctedInvoice({ transactionType: TRANSACTION_TYPES.income, customerName: CUSTOMER_NAME }),
      });

      expect(asExpense.response!.candidates).toEqual([]);
      expect(asIncome.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
    });

    it('returns no candidates when the corrected total matches nothing', async () => {
      const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ totalAmount: 9876.54 }) });

      expect(result.statusCode).toBe(200);
      expect(result.response!.candidates).toEqual([]);
    });

    it('rejects invoice fields that are not valid', async () => {
      const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ totalAmount: -5 }) });

      expect(result.statusCode).toBe(422);
    });

    it('rejects an issue date that is not a real calendar day', async () => {
      const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ issueDate: '2026-02-30' }) });

      expect(result.statusCode).toBe(422);
    });

    it('rejects an invoice link that is not https', async () => {
      const result = await helpers.rematchInvoice({
        invoice: correctedInvoice({ invoiceUrl: 'http://acme.test/invoices/42' }),
      });

      expect(result.statusCode).toBe(422);
    });

    it('never offers a transfer leg, even an exactly matching one', async () => {
      const source = await helpers.createAccount({ raw: true });
      const destination = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: INVOICE_DECIMAL,
          destinationAccountId: destination.id,
        }),
        raw: true,
      });
      const [expense] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: source.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
        }),
        raw: true,
      });

      const result = await helpers.rematchInvoice({ invoice: correctedInvoice() });

      expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([expense!.id]);
    });

    it('includes the date-window edges and excludes the days just outside them', async () => {
      const account = await helpers.createAccount({ raw: true });
      const paidOn = async (day: string) => {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: INVOICE_DECIMAL,
            time: `${day}T00:00:00.000Z`,
          }),
          raw: true,
        });
        return tx!.id;
      };

      const firstDay = await paidOn('2026-05-27');
      const lastDay = await paidOn('2026-07-10');
      await paidOn('2026-05-26');
      await paidOn('2026-07-11');

      const result = await helpers.rematchInvoice({ invoice: correctedInvoice() });

      expect(result.response!.candidates.map((candidate) => candidate.transaction.id).toSorted()).toEqual(
        [firstDay, lastDay].toSorted(),
      );
    });

    it("never returns another user's matching transaction", async () => {
      const second = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: second.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY_CODE });
          const account = await helpers.createAccount({ raw: true });
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: INVOICE_DECIMAL,
              time: PAYMENT_TIME,
              note: 'ACME CLOUD SERVICES',
            }),
            raw: true,
          });
        },
      });

      const result = await helpers.rematchInvoice({ invoice: correctedInvoice() });

      expect(result.statusCode).toBe(200);
      expect(result.response!.candidates).toEqual([]);
    });

    it('treats the merchant as unknown when an issued invoice names no customer', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({ payload: { name: CUSTOMER_NAME }, raw: true });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: INVOICE_DECIMAL,
          time: PAYMENT_TIME,
          transactionType: TRANSACTION_TYPES.income,
          payeeId: payee.id,
        }),
        raw: true,
      });

      const result = await helpers.rematchInvoice({
        invoice: correctedInvoice({ transactionType: TRANSACTION_TYPES.income }),
      });

      expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
      expect(result.response!.candidates[0]!.signals.merchant).toBe('unknown');
    });

    describe('cross-currency', () => {
      const issueDay = new Date(`${ISSUE_DATE}T00:00:00.000Z`);
      const paymentDate = '2026-06-15';
      const paymentDay = new Date(`${paymentDate}T00:00:00.000Z`);

      afterEach(() => helpers.clearExchangeRatesForDates({ dates: [issueDay, paymentDay] }));

      it('matches a foreign-currency invoice against the base-currency payment it converts to', async () => {
        await helpers.seedUsdExchangeRates({
          date: issueDay,
          ratesPerUsd: { [global.BASE_CURRENCY_CODE]: helpers.AED_PER_USD },
        });

        const account = await helpers.createAccount({ raw: true });
        const [payment] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: INVOICE_DECIMAL * helpers.AED_PER_USD,
            time: PAYMENT_TIME,
          }),
          raw: true,
        });

        const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ currencyCode: 'USD' }) });

        expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
        expect(result.response!.candidates[0]!.signals.amount).toBe('converted');
      });

      it('finds the payment in the invoice currency when the rate moved between the two days', async () => {
        await helpers.seedUsdExchangeRates({
          date: issueDay,
          ratesPerUsd: { [global.BASE_CURRENCY_CODE]: helpers.AED_PER_USD },
        });
        // The dollar doubles against the base currency by payment day, so the payment's stored
        // base amount lands nowhere near the invoice's.
        await helpers.seedUsdExchangeRates({
          date: paymentDay,
          ratesPerUsd: { [global.BASE_CURRENCY_CODE]: helpers.AED_PER_USD * 2 },
        });

        const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
        const [payment] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: INVOICE_DECIMAL,
            time: `${paymentDate}T12:00:00.000Z`,
          }),
          raw: true,
        });

        const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ currencyCode: 'USD' }) });

        expect(result.statusCode).toBe(200);
        expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
        expect(result.response!.candidates[0]!.signals.amount).toBe('exact');
      });

      it('matches a same-currency payment with no rate pinned for the issue day', async () => {
        const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
        const [payment] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: INVOICE_DECIMAL,
            time: PAYMENT_TIME,
          }),
          raw: true,
        });

        const result = await helpers.rematchInvoice({ invoice: correctedInvoice({ currencyCode: 'USD' }) });

        expect(result.statusCode).toBe(200);
        expect(result.response!.candidates.map((candidate) => candidate.transaction.id)).toEqual([payment!.id]);
        expect(result.response!.candidates[0]!.signals.amount).toBe('exact');
      });
    });
  });

  /**
   * A plan without `invoice_matching` runs on the server key for its free tries, so these
   * dial the operator's Gemini model rather than a user-owned endpoint.
   */
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

    const upload = () => helpers.matchInvoice({ file: PNG_BYTES });

    const spendTrial = async () => {
      mockOperatorAnswer({ content: invoiceAnswer() });
      for (let attempt = 0; attempt < TRIAL_LIMIT; attempt++) {
        expect((await upload()).statusCode).toBe(200);
      }
    };

    it('gives an essential user its free uploads and 402s the next', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });

      await spendTrial();

      expect((await upload()).statusCode).toBe(402);
      expect(await usedTries()).toBe(TRIAL_LIMIT);
    });

    it('sends a PDF to a native provider as the file itself, not its text', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });
      mockOperatorAnswer({ content: invoiceAnswer() });

      const result = await helpers.matchInvoice({
        file: readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.encrypted }),
      });

      expect(result.statusCode).toBe(200);
    });

    it('gives an early adopter the same free uploads', async () => {
      await helpers.setUserBilling({ plan: PLANS.early_adopter });

      await spendTrial();

      expect((await upload()).statusCode).toBe(402);
    });

    it('spends no try when the AI does not recognise an invoice', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });

      mockOperatorAnswer({ content: notAnInvoiceAnswer });
      for (let attempt = 0; attempt < TRIAL_LIMIT; attempt++) {
        expect((await upload()).statusCode).toBe(422);
      }
      expect(await usedTries()).toBe(0);

      mockOperatorAnswer({ content: invoiceAnswer() });
      expect((await upload()).statusCode).toBe(200);
      expect(await usedTries()).toBe(1);
    });

    it('still ranks corrected candidates once the trial is spent', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });

      await spendTrial();
      expect((await upload()).statusCode).toBe(402);

      const rematch = await helpers.rematchInvoice({ invoice: correctedInvoice() });

      expect(rematch.statusCode).toBe(200);
      expect(await usedTries()).toBe(TRIAL_LIMIT);
    });

    it('leaves a plus subscriber unlimited and uncounted', async () => {
      await helpers.setUserBilling({ plan: PLANS.plus });

      await spendTrial();

      expect((await upload()).statusCode).toBe(200);

      // A plan that holds the feature outright reports no trial counter at all, so the
      // counter is only readable once the user drops to one that trials it.
      await helpers.setUserBilling({ plan: PLANS.essential });
      expect(await usedTries()).toBe(0);
    });
  });
});
