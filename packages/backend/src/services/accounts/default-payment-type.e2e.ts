import { PAYMENT_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createAccountWithDefault = ({ defaultPaymentType }: { defaultPaymentType?: PAYMENT_TYPES | null }) =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ defaultPaymentType }), raw: true });

describe('Account default payment type', () => {
  describe('account endpoints', () => {
    it('returns null when no default is set', async () => {
      const account = await createAccountWithDefault({});

      expect(account.defaultPaymentType).toBeNull();
      expect((await helpers.getAccount({ id: account.id, raw: true })).defaultPaymentType).toBeNull();
    });

    it('stores the default given on create and returns it everywhere', async () => {
      const account = await createAccountWithDefault({ defaultPaymentType: PAYMENT_TYPES.cash });

      expect(account.defaultPaymentType).toBe(PAYMENT_TYPES.cash);
      expect((await helpers.getAccount({ id: account.id, raw: true })).defaultPaymentType).toBe(PAYMENT_TYPES.cash);
      expect((await helpers.getAccounts()).find((a) => a.id === account.id)!.defaultPaymentType).toBe(
        PAYMENT_TYPES.cash,
      );
    });

    it('sets, keeps and clears the default on update', async () => {
      const account = await createAccountWithDefault({});

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { defaultPaymentType: PAYMENT_TYPES.debitCard },
        raw: true,
      });
      expect(updated.defaultPaymentType).toBe(PAYMENT_TYPES.debitCard);

      const renamed = await helpers.updateAccount({ id: account.id, payload: { name: 'renamed' }, raw: true });
      expect(renamed.defaultPaymentType).toBe(PAYMENT_TYPES.debitCard);

      const cleared = await helpers.updateAccount({
        id: account.id,
        payload: { defaultPaymentType: null },
        raw: true,
      });
      expect(cleared.defaultPaymentType).toBeNull();
    });

    it('rejects an unknown payment type', async () => {
      const createRes = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ defaultPaymentType: 'bogus' as PAYMENT_TYPES }),
        raw: false,
      });
      expect(createRes.statusCode).toBe(ERROR_CODES.ValidationError);

      const account = await createAccountWithDefault({});
      const updateRes = await helpers.updateAccount({
        id: account.id,
        payload: { defaultPaymentType: 'bogus' as PAYMENT_TYPES },
      });
      expect(updateRes.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('transaction creation', () => {
    it('inherits the account default when paymentType is omitted', async () => {
      const account = await createAccountWithDefault({ defaultPaymentType: PAYMENT_TYPES.cash });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, paymentType: undefined }),
        raw: true,
      });

      expect(tx.paymentType).toBe(PAYMENT_TYPES.cash);
    });

    it('falls back to bankTransfer when the account has no default', async () => {
      const account = await createAccountWithDefault({});

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, paymentType: undefined }),
        raw: true,
      });

      expect(tx.paymentType).toBe(PAYMENT_TYPES.bankTransfer);
    });

    it('keeps an explicit paymentType over the account default', async () => {
      const account = await createAccountWithDefault({ defaultPaymentType: PAYMENT_TYPES.cash });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, paymentType: PAYMENT_TYPES.voucher }),
        raw: true,
      });

      expect(tx.paymentType).toBe(PAYMENT_TYPES.voucher);
    });
  });
});
