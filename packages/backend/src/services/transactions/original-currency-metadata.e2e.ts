import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';

// The create helper declares the Sequelize model as its raw return type, but the endpoint
// answers with the serialized response: money fields are decimals, not Money instances.
const createTx = async (payload: Parameters<typeof helpers.buildTransactionPayload>[0]) => {
  const result = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload(payload),
    raw: true,
  });
  return (result as unknown as (TransactionApiResponse & { id: RecordId })[])[0]!;
};

// Both request schemas answer 422 from a dozen different rules, so a status-only assertion
// would stay green while an unrelated rule fires. Every negative case pins its own message.
const RULES = {
  createPairTogether: '"originalAmount" and "originalCurrencyCode" must be provided together',
  updatePairTogether: '"originalAmount" and "originalCurrencyCode" must be set, or cleared, together',
  transferPayload: 'Original currency metadata cannot be added to transfer transactions',
  invalidCurrencyCode: 'Invalid currency code',
};

const expectRejectedBy = ({ response, rule }: { response: unknown; rule: string }) => {
  const rejection = response as helpers.CustomResponse<{ message: string }>;

  expect(rejection.statusCode).toBe(ERROR_CODES.ValidationError);
  expect(rejection.body.response.message).toContain(rule);
};

describe('Transaction original-currency metadata', () => {
  describe('POST /transactions', () => {
    it('rounds the original amount to the decimals of the original currency', async () => {
      const account = await helpers.createAccount({ raw: true });

      const inJpy = await createTx({
        accountId: account.id,
        amount: 30,
        originalAmount: 5000.55,
        originalCurrencyCode: 'JPY',
      });
      const inKwd = await createTx({
        accountId: account.id,
        amount: 30,
        originalAmount: 5.12345,
        originalCurrencyCode: 'KWD',
      });

      expect(inJpy.originalAmount).toBe(5001);
      expect(inKwd.originalAmount).toBe(5.123);
    });

    it('stores the pair as decimals, defaults it to null and never connects the currency', async () => {
      const account = await helpers.createAccount({ raw: true });

      const created = await createTx({
        accountId: account.id,
        amount: 30,
        originalAmount: 5000.55,
        originalCurrencyCode: 'CHF',
      });

      expect(created.originalAmount).toBe(5000.55);
      expect(created.originalCurrencyCode).toBe('CHF');

      const fetched = await helpers.getTransactionById({ id: created.id, raw: true });

      expect(fetched!.originalAmount).toBe(5000.55);
      expect(fetched!.originalCurrencyCode).toBe('CHF');

      const withoutPair = await createTx({ accountId: account.id, amount: 30 });

      expect(withoutPair.originalAmount).toBeNull();
      expect(withoutPair.originalCurrencyCode).toBeNull();

      const connectedCurrencies = await helpers.getUserCurrencies();
      expect(connectedCurrencies.some((item) => item.currencyCode === 'CHF')).toBe(false);
    });

    it('rejects half a pair, an unknown currency and the pair on a transfer', async () => {
      const [account, destination] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const withoutCurrencyCode = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 30, originalAmount: 5000 }),
      });
      expectRejectedBy({ response: withoutCurrencyCode, rule: RULES.createPairTogether });

      const unknownCurrency = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          originalAmount: 5000,
          originalCurrencyCode: 'ZZZ',
        }),
      });
      expectRejectedBy({ response: unknownCurrency, rule: RULES.invalidCurrencyCode });

      const onTransfer = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 30,
          originalAmount: 5000,
          originalCurrencyCode: 'JPY',
        }),
      });
      expectRejectedBy({ response: onTransfer, rule: RULES.transferPayload });
    });

    it('does not affect the account balance or refAmount', async () => {
      const [plain, withOriginal] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const plainTx = await createTx({
        accountId: plain.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.expense,
      });
      const originalTx = await createTx({
        accountId: withOriginal.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.expense,
        originalAmount: 5000,
        originalCurrencyCode: 'JPY',
      });

      expect(originalTx.refAmount).toBe(plainTx.refAmount);

      const [plainAccount, withOriginalAccount] = await Promise.all([
        helpers.getAccount({ id: plain.id, raw: true }),
        helpers.getAccount({ id: withOriginal.id, raw: true }),
      ]);

      expect(withOriginalAccount.currentBalance).toBe(plainAccount.currentBalance);
      expect(withOriginalAccount.refCurrentBalance).toBe(plainAccount.refCurrentBalance);
    });
  });

  describe('PUT /transactions/:id', () => {
    it('sets the pair on an existing transaction', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await createTx({ accountId: account.id, amount: 30 });

      const response = await helpers.updateTransaction({
        id: created.id,
        payload: { originalAmount: 5000, originalCurrencyCode: 'JPY' },
      });

      expect(response.statusCode).toBe(200);

      const updated = await helpers.getTransactionById({ id: created.id, raw: true });
      expect(updated!.originalAmount).toBe(5000);
      expect(updated!.originalCurrencyCode).toBe('JPY');
    });

    it('clears the pair when both are sent as null', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await createTx({
        accountId: account.id,
        amount: 30,
        originalAmount: 5000,
        originalCurrencyCode: 'JPY',
      });

      const response = await helpers.updateTransaction({
        id: created.id,
        payload: { originalAmount: null, originalCurrencyCode: null },
      });

      expect(response.statusCode).toBe(200);

      const updated = await helpers.getTransactionById({ id: created.id, raw: true });
      expect(updated!.originalAmount).toBeNull();
      expect(updated!.originalCurrencyCode).toBeNull();
    });

    it('keeps the stored pair when the request touches neither field', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await createTx({
        accountId: account.id,
        amount: 30,
        originalAmount: 5000,
        originalCurrencyCode: 'JPY',
      });

      await helpers.updateTransaction({ id: created.id, payload: { note: 'ramen' } });

      const updated = await helpers.getTransactionById({ id: created.id, raw: true });
      expect(updated!.originalAmount).toBe(5000);
      expect(updated!.originalCurrencyCode).toBe('JPY');
    });

    it('rejects half a pair and the pair on anything that turns into a transfer', async () => {
      const [source, destination] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const plain = await createTx({
        accountId: source.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.expense,
      });
      const withPair = await createTx({
        accountId: source.id,
        amount: 30,
        originalAmount: 5000,
        originalCurrencyCode: 'JPY',
      });

      const halfSet = await helpers.updateTransaction({ id: plain.id, payload: { originalAmount: 5000 } });
      expectRejectedBy({ response: halfSet, rule: RULES.updatePairTogether });

      const halfCleared = await helpers.updateTransaction({ id: withPair.id, payload: { originalAmount: null } });
      expectRejectedBy({ response: halfCleared, rule: RULES.updatePairTogether });

      const toTransfer = await helpers.updateTransaction({
        id: plain.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 30,
          originalAmount: 5000,
          originalCurrencyCode: 'JPY',
        },
      });
      expectRejectedBy({ response: toTransfer, rule: RULES.transferPayload });

      const implicitTransfer = await helpers.updateTransaction({
        id: plain.id,
        payload: {
          destinationAccountId: destination.id,
          destinationAmount: 30,
          originalAmount: 5000,
          originalCurrencyCode: 'JPY',
        },
      });
      expectRejectedBy({ response: implicitTransfer, rule: RULES.transferPayload });
    });

    it('keeps the stored pair through a transfer round-trip and never copies it to the opposite leg', async () => {
      const [source, destination] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const created = await createTx({
        accountId: source.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.expense,
        originalAmount: 5000,
        originalCurrencyCode: 'JPY',
      });

      const toTransfer = await helpers.updateTransaction({
        id: created.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 30,
        },
      });
      expect(toTransfer.statusCode).toBe(200);

      const base = await helpers.getTransactionById({ id: created.id, raw: true });
      expect(base!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(base!.originalAmount).toBe(5000);
      expect(base!.originalCurrencyCode).toBe('JPY');

      const legs = await helpers.getTransactionsByTransferId({ transferId: base!.transferId!, raw: true });
      const opposite = legs.find((leg) => leg.id !== created.id)!;
      expect(opposite.originalAmount).toBeNull();
      expect(opposite.originalCurrencyCode).toBeNull();

      const backToExpense = await helpers.updateTransaction({
        id: created.id,
        payload: { transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer },
      });
      expect(backToExpense.statusCode).toBe(200);

      const reverted = await helpers.getTransactionById({ id: created.id, raw: true });
      expect(reverted!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(reverted!.originalAmount).toBe(5000);
      expect(reverted!.originalCurrencyCode).toBe('JPY');
    });
  });
});
