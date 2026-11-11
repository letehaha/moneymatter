import {
  ACCOUNT_STATUSES,
  PLANS,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { enableServerModel, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createFirstConnection } from '@tests/helpers/user-settings';
import { GEMINI_API_URL } from '@tests/mocks/gemini/mock-api';
import { getMockedClientData } from '@tests/mocks/monobank/data';
import { MONOBANK_URLS_MOCK, getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import {
  getCustomEndpointContentMock,
  getCustomEndpointDynamicMock,
  getCustomEndpointOfflineMock,
} from '@tests/mocks/openai-compatible/mock-api';
import { HttpResponse, http } from 'msw';

const SMS = 'Card *4821: purchase 1 234,50 UAH at SILPO. Balance 5 000,00 UAH';

const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    isTransaction: true,
    transactionType: 'expense',
    amount: 1234.5,
    currencyCode: 'uah',
    merchant: ' SILPO ',
    cardHint: '*4821',
    payeeName: null,
    categoryName: null,
    accountName: null,
    ...overrides,
  });

const NOT_A_TRANSACTION = {
  isTransaction: false,
  transactionType: null,
  amount: null,
  currencyCode: null,
  merchant: null,
  cardHint: null,
  suggestedAccountId: null,
  suggestedPayeeId: null,
  suggestedCategoryId: null,
};

const createAccount = ({ name }: { name: string }) =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ name }), raw: true });

const accountLabel = ({ name }: { name: string }) => `${name} (${global.BASE_CURRENCY_CODE}, manual)`;

const knownAccountEntry = ({ account }: { account: { name: string; currencyCode: string; type: string } }) =>
  `${account.name} (${account.currencyCode}, ${account.type})`;

const connectMonobankCards = async ({ uahCardTail, usdCardTail }: { uahCardTail: string; usdCardTail: string }) => {
  const [uahCard, usdCard] = getMockedClientData().accounts;
  global.mswMockServer.use(
    http.get(MONOBANK_URLS_MOCK.clientInfo, () =>
      HttpResponse.json({
        ...getMockedClientData(),
        accounts: [
          { ...uahCard, maskedPan: [`537541******${uahCardTail}`] },
          { ...usdCard, maskedPan: [`537541******${usdCardTail}`] },
        ],
      }),
    ),
    getMonobankTransactionsMock(),
  );
  const { connectionId } = await helpers.monobank.pair();
  await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [uahCard!.id, usdCard!.id],
    raw: true,
  });
  const accounts = await helpers.getAccounts();

  return {
    uah: accounts.find((account) => account.currencyCode === 'UAH')!,
    usd: accounts.find((account) => account.currencyCode === 'USD')!,
  };
};

describe('POST /transactions/extract-message', () => {
  describe('with a user-owned AI connection', () => {
    useSelfHostWithoutServerAiKeys();

    it('returns the transaction fields with a decimal amount', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

      const result = await helpers.extractMessage({ text: `  ${SMS}  ` });

      expect(result.statusCode).toBe(200);
      expect(result.response).toEqual({
        isTransaction: true,
        transactionType: TRANSACTION_TYPES.expense,
        amount: 1234.5,
        currencyCode: 'UAH',
        merchant: 'SILPO',
        cardHint: '*4821',
        suggestedAccountId: null,
        suggestedPayeeId: null,
        suggestedCategoryId: null,
      });
    });

    it('sends the message and the known payees, categories and accounts to the AI', async () => {
      await createFirstConnection();
      await createAccount({ name: 'Wallet' });
      await helpers.createPayee({ payload: { name: 'Silpo' }, raw: true });
      await helpers.addCustomCategory({ name: 'Groceries', color: '#111111', raw: true });
      let prompt = '';
      global.mswMockServer.use(
        getCustomEndpointDynamicMock({
          respond: ({ body }) => {
            prompt = JSON.stringify(body.messages);
            return answer();
          },
        }),
      );

      await helpers.extractMessage({ text: `  ${SMS}  ` });

      expect(prompt).toContain('Known payees:\\nSilpo');
      expect(prompt).toContain('Groceries');
      expect(prompt).toContain(`Known accounts:\\n${accountLabel({ name: 'Wallet' })}`);
      expect(prompt).toContain(`Message:\\n${SMS}"`);
    });

    it('reports a non-transaction message with every field null, whatever else the AI filled in', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ isTransaction: false }) }));

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.statusCode).toBe(200);
      expect(result.response).toEqual(NOT_A_TRANSACTION);
    });

    it.each([
      ['an amount the message does not contain', { amount: 9999 }],
      ['a zero amount', { amount: 0 }],
      ['no amount', { amount: null }],
      ['no transaction type', { transactionType: null }],
    ])('drops an answer with %s', async (_label, overrides) => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer(overrides) }));

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.statusCode).toBe(200);
      expect(result.response).toEqual(NOT_A_TRANSACTION);
    });

    it('does not take an amount from the "Sender:" line the app puts first', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ amount: 9999 }) }));

      const result = await helpers.extractMessage({ text: `Sender: 9999\n${SMS}` });

      expect(result.response).toEqual(NOT_A_TRANSACTION);
    });

    it('returns a positive amount when the AI reports the debit as negative', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ amount: -1234.5 }) }));

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.response).toMatchObject({ isTransaction: true, amount: 1234.5 });
    });

    it('422s when the AI answer is not the expected JSON, so the client does not retry it as an outage', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: 'Sorry, I cannot read this.' }));

      expect((await helpers.extractMessage({ text: SMS })).statusCode).toBe(422);
    });

    it('422s when the AI spends its token budget before writing any answer', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: '', finishReason: 'length' }));

      expect((await helpers.extractMessage({ text: SMS })).statusCode).toBe(422);
    });

    it('reads a multi-line message under a "Sender:" line', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

      const result = await helpers.extractMessage({ text: 'Sender: Monobank\nPurchase\n1 234,50 UAH\nSILPO' });

      expect(result.response).toMatchObject({ isTransaction: true, amount: 1234.5 });
    });

    it('keeps the transaction and nulls a currency that is not an ISO code', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ currencyCode: 'грн' }) }));

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.response).toMatchObject({ isTransaction: true, amount: 1234.5, currencyCode: null });
    });

    it('502s when the AI endpoint does not answer, so the client can retry later', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointOfflineMock());

      expect((await helpers.extractMessage({ text: SMS })).statusCode).toBe(502);
    });

    it("suggests the user's own payee and category the AI picked", async () => {
      await createFirstConnection();
      const payee = await helpers.createPayee({ payload: { name: 'Silpo' }, raw: true });
      const groceries = await helpers.addCustomCategory({ name: 'Groceries', color: '#111111', raw: true });
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: answer({ payeeName: 'silpo', categoryName: 'Groceries' }) }),
      );

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.response).toMatchObject({ suggestedPayeeId: payee.id, suggestedCategoryId: groceries.id });
    });

    it('suggests nothing when the AI names a payee or category the user does not have', async () => {
      await createFirstConnection();
      await helpers.createPayee({ payload: { name: 'Silpo' }, raw: true });
      global.mswMockServer.use(
        getCustomEndpointContentMock({ content: answer({ payeeName: 'ATB', categoryName: 'Invented' }) }),
      );

      const result = await helpers.extractMessage({ text: SMS });

      expect(result.response).toMatchObject({ suggestedPayeeId: null, suggestedCategoryId: null });
    });

    describe('account suggestion', () => {
      it('suggests the bank-connected account whose card number ends with the digits in the message', async () => {
        await createFirstConnection();
        const { usd } = await connectMonobankCards({ uahCardTail: '9999', usdCardTail: '4821' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

        const result = await helpers.extractMessage({ text: SMS });

        expect(result.response!.suggestedAccountId).toBe(usd.id);
      });

      it('suggests the card-matched account over the one the AI named', async () => {
        await createFirstConnection();
        const { uah, usd } = await connectMonobankCards({ uahCardTail: '9999', usdCardTail: '4821' });
        global.mswMockServer.use(
          getCustomEndpointContentMock({ content: answer({ accountName: knownAccountEntry({ account: uah }) }) }),
        );

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBe(usd.id);
      });

      it('does not match a card by digits that appear only on the "Sender:" line', async () => {
        await createFirstConnection();
        await connectMonobankCards({ uahCardTail: '9999', usdCardTail: '4821' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

        const result = await helpers.extractMessage({ text: 'Sender: *4821\nPurchase 1 234,50 UAH at SILPO' });

        expect(result.response).toMatchObject({ isTransaction: true, suggestedAccountId: null });
      });

      it('leaves two accounts sharing the card digits for the AI to tell apart', async () => {
        await createFirstConnection();
        const { usd } = await connectMonobankCards({ uahCardTail: '4821', usdCardTail: '4821' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBeNull();

        global.mswMockServer.use(
          getCustomEndpointContentMock({ content: answer({ accountName: knownAccountEntry({ account: usd }) }) }),
        );

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBe(usd.id);
      });

      it('rules out an account known to hold other cards when the message names a card it does not have', async () => {
        await createFirstConnection();
        const { uah } = await connectMonobankCards({ uahCardTail: '1111', usdCardTail: '2222' });
        const wallet = await createAccount({ name: 'Wallet' });
        global.mswMockServer.use(
          getCustomEndpointContentMock({ content: answer({ accountName: knownAccountEntry({ account: uah }) }) }),
        );

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBeNull();

        global.mswMockServer.use(
          getCustomEndpointContentMock({ content: answer({ accountName: accountLabel({ name: 'Wallet' }) }) }),
        );

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBe(wallet.id);
      });

      it('suggests nothing for a bare name two accounts share, and the one whose whole entry the AI named', async () => {
        await createFirstConnection();
        await createAccount({ name: 'Card' });
        await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true });
        const uahCard = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'Card', currencyCode: 'UAH' }),
          raw: true,
        });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ accountName: 'Card' }) }));

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBeNull();

        global.mswMockServer.use(
          getCustomEndpointContentMock({ content: answer({ accountName: 'Card (UAH, manual)' }) }),
        );

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBe(uahCard.id);
      });

      it.each([
        ['the whole entry', () => ` ${accountLabel({ name: 'mono black' }).toUpperCase()} `],
        ['only the account name', () => 'mono black'],
      ])('suggests the account the AI named from the known list by %s', async (_label, accountName) => {
        await createFirstConnection();
        await createAccount({ name: 'Wallet' });
        const mono = await createAccount({ name: 'Mono Black' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ accountName: accountName() }) }));

        expect((await helpers.extractMessage({ text: SMS })).response!.suggestedAccountId).toBe(mono.id);
      });

      it("suggests nothing when only the message's currency points at an account", async () => {
        await createFirstConnection();
        await createAccount({ name: 'Wallet' });
        await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

        const result = await helpers.extractMessage({ text: SMS });

        expect(result.response).toMatchObject({ isTransaction: true, currencyCode: 'UAH', suggestedAccountId: null });
      });

      it.each([
        ['names none', null],
        ['names one the user does not have', 'Invented'],
      ])('suggests nothing between two equally plausible accounts when the AI %s', async (_label, accountName) => {
        await createFirstConnection();
        await createAccount({ name: 'Wallet' });
        await createAccount({ name: 'Card' });
        global.mswMockServer.use(getCustomEndpointContentMock({ content: answer({ accountName }) }));

        const result = await helpers.extractMessage({ text: SMS });

        expect(result.response).toMatchObject({ isTransaction: true, suggestedAccountId: null });
      });

      it('leaves archived, loan and vehicle accounts out of the candidates', async () => {
        await createFirstConnection();
        const archived = await createAccount({ name: 'Old card' });
        await helpers.updateAccount({ id: archived.id, payload: { status: ACCOUNT_STATUSES.archived }, raw: true });
        await helpers.createLoan({
          payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY_CODE }),
          raw: true,
        });
        await helpers.createVehicle({
          name: 'Car',
          currencyCode: global.BASE_CURRENCY_CODE,
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          vehicleClass: VEHICLE_CLASS.sedan,
          purchasePrice: 25000,
          purchaseDate: '2024-01-15',
          raw: true,
        });
        await createAccount({ name: 'Wallet' });
        let prompt = '';
        global.mswMockServer.use(
          getCustomEndpointDynamicMock({
            respond: ({ body }) => {
              prompt = JSON.stringify(body.messages);
              return answer({ accountName: accountLabel({ name: 'Old card' }) });
            },
          }),
        );

        const result = await helpers.extractMessage({ text: SMS });

        expect(result.response).toMatchObject({ isTransaction: true, suggestedAccountId: null });
        expect(prompt).toContain(accountLabel({ name: 'Wallet' }));
        expect(prompt).not.toContain('Old card');
        expect(prompt).not.toContain('Test loan');
        expect(prompt).not.toContain('Car (');
      });

      it("never suggests another user's account, even one shared with the caller", async () => {
        const shared = await createAccount({ name: 'Wallet' });
        const recipient = await helpers.provisionSecondUserWithBaseCurrency();
        const invitation = await helpers.createShareInvitation({
          inviteeEmail: recipient.email,
          resourceType: RESOURCE_TYPES.account,
          resourceId: shared.id,
          permission: SHARE_PERMISSIONS.write,
          raw: true,
        });
        global.mswMockServer.use(
          getCustomEndpointContentMock({
            content: answer({ accountName: accountLabel({ name: 'Wallet' }) }),
          }),
        );

        const result = await helpers.asUser({
          cookies: recipient.cookies,
          fn: async () => {
            await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
            await createFirstConnection();
            return helpers.extractMessage({ text: SMS });
          },
        });

        expect(result.response).toMatchObject({ isTransaction: true, suggestedAccountId: null });
      });
    });

    it.each([
      ['blank', '   '],
      ['oversized', 'a'.repeat(2001)],
      ['missing', undefined],
    ])('rejects %s text', async (_label, text) => {
      // A working AI connection makes the 422 come from request validation alone.
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

      expect((await helpers.extractMessage({ text })).statusCode).toBe(422);
    });

    it('accepts text at the length cap', async () => {
      await createFirstConnection();
      global.mswMockServer.use(getCustomEndpointContentMock({ content: answer() }));

      const result = await helpers.extractMessage({ text: SMS.padEnd(2000, '.') });

      expect(result.response).toMatchObject({ isTransaction: true });
    });
  });

  describe('on the server model', () => {
    useSelfHostWithoutServerAiKeys();

    it("counts the call toward the user's AI allowance", async () => {
      enableServerModel();
      // One mocked call costs $0.000155; usedPercent is floored, so a much larger cap would still read 0.
      process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.001';
      global.mswMockServer.use(
        http.post(GEMINI_API_URL, () =>
          HttpResponse.json({
            candidates: [{ content: { parts: [{ text: answer() }], role: 'model' }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
          }),
        ),
      );

      expect((await helpers.extractMessage({ text: SMS })).statusCode).toBe(200);
      expect((await helpers.getAiFeaturesStatus({ raw: true })).aiAllowance!.usedPercent).toBeGreaterThan(0);
    });
  });

  it('402s when the plan does not include invoice matching', async () => {
    await helpers.setUserBilling({ plan: PLANS.essential });

    expect((await helpers.extractMessage({ text: SMS })).statusCode).toBe(402);
  });
});
