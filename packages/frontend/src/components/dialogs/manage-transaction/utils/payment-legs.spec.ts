import { type AccountModel, type RecordId, type TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import type { FormPaymentLeg } from '../types';
import {
  formLegsToPaymentLegs,
  hasPaymentParts,
  isPaymentLegIncomplete,
  paymentPartsToFormLegs,
  refreshLegPaymentAmount,
  resolvePaymentLegsUpdate,
  setPaymentLegAmount,
  sumMainWithCreatedLegs,
  sumPaymentRows,
} from './payment-legs';

const card = { id: 'acc-card' as RecordId, name: 'Card', currencyCode: 'EUR' } as AccountModel;
const voucher = { id: 'acc-voucher' as RecordId, name: 'Voucher', currencyCode: 'EUR' } as AccountModel;
const cash = { id: 'acc-cash' as RecordId, name: 'Cash', currencyCode: 'USD' } as AccountModel;

const parts = [
  {
    transactionId: 'tx-main' as RecordId,
    accountId: card.id,
    amount: 70,
    currencyCode: 'EUR',
    paymentAmount: 70,
    isLinked: false,
  },
  {
    transactionId: 'tx-leg' as RecordId,
    accountId: voucher.id,
    amount: 30,
    currencyCode: 'EUR',
    paymentAmount: 30,
    isLinked: false,
  },
];
const crossParts = [
  parts[0]!,
  {
    transactionId: 'tx-cash' as RecordId,
    accountId: cash.id,
    amount: 35,
    currencyCode: 'USD',
    paymentAmount: 30,
    isLinked: true,
  },
];

const tx = (overrides: Partial<TransactionModel> = {}) =>
  ({ id: 'tx-main', currencyCode: 'EUR', ...overrides }) as TransactionModel;

const savedLeg: FormPaymentLeg = {
  transactionId: 'tx-leg' as RecordId,
  account: voucher,
  accountId: voucher.id,
  amount: 30,
  currencyCode: 'EUR',
  paymentAmount: 30,
  isLinked: false,
  isPaymentAmountEdited: true,
};
const linkedCashLeg: FormPaymentLeg = {
  transactionId: 'tx-cash' as RecordId,
  account: cash,
  accountId: cash.id,
  amount: 35,
  currencyCode: 'USD',
  paymentAmount: 30,
  isLinked: true,
  isPaymentAmountEdited: true,
};

const convert = ({ amount, from, to }: { amount: number; from: string; to: string }) =>
  from === 'USD' && to === 'EUR' ? Math.round((amount / 1.0875) * 100) / 100 : null;

describe('payment legs helpers', () => {
  it('builds form legs from every part except the main one', () => {
    expect(
      paymentPartsToFormLegs({
        parts,
        mainTransactionId: 'tx-main',
        accounts: { [card.id]: card, [voucher.id]: voucher },
      }),
    ).toEqual([savedLeg]);
  });

  it('keeps the account id of a part whose account is unknown', () => {
    expect(paymentPartsToFormLegs({ parts, mainTransactionId: 'tx-main', accounts: {} })).toEqual([
      { ...savedLeg, account: null },
    ]);
  });

  it('sums the main amount and every leg, treating blanks as zero', () => {
    expect(
      sumPaymentRows({
        mainAmount: 70,
        legs: [
          { account: voucher, amount: 30, currencyCode: 'EUR' },
          { account: null, amount: null },
        ],
        mainCurrencyCode: 'EUR',
      }),
    ).toBe(100);
    expect(sumPaymentRows({ mainAmount: null, legs: [], mainCurrencyCode: 'EUR' })).toBe(0);
  });

  it('rounds the total to cents', () => {
    expect(
      sumPaymentRows({
        mainAmount: 10.1,
        legs: [{ account: voucher, amount: 20.2, currencyCode: 'EUR' }],
        mainCurrencyCode: 'EUR',
      }),
    ).toBe(30.3);
  });

  it('sums a cross-currency leg by its share in the main currency', () => {
    expect(
      sumPaymentRows({
        mainAmount: 70,
        legs: [linkedCashLeg, { account: voucher, amount: 10, currencyCode: 'EUR', paymentAmount: 999 }],
        mainCurrencyCode: 'EUR',
      }),
    ).toBe(110);
    expect(
      sumPaymentRows({
        mainAmount: 70,
        legs: [{ ...linkedCashLeg, paymentAmount: null }],
        mainCurrencyCode: 'EUR',
      }),
    ).toBe(70);
  });

  it('folds only created legs back into the main amount', () => {
    expect(
      sumMainWithCreatedLegs({
        mainAmount: 70,
        legs: [savedLeg, linkedCashLeg, { account: voucher, amount: 5, currencyCode: 'EUR' }],
        mainCurrencyCode: 'EUR',
      }),
    ).toBe(105);
    expect(sumMainWithCreatedLegs({ mainAmount: 70, legs: [linkedCashLeg], mainCurrencyCode: 'EUR' })).toBe(70);
  });

  describe('setPaymentLegAmount', () => {
    const savedCashLeg: FormPaymentLeg = { ...linkedCashLeg, isLinked: false };

    it('scales a user-set share by the new amount at the same rate', () => {
      expect(setPaymentLegAmount({ leg: savedCashLeg, amount: 70, mainCurrencyCode: 'EUR', convert })).toMatchObject({
        amount: 70,
        paymentAmount: 60,
        isPaymentAmountEdited: true,
      });
      expect(
        setPaymentLegAmount({ leg: savedCashLeg, amount: 10, mainCurrencyCode: 'EUR', convert }).paymentAmount,
      ).toBe(8.57);
    });

    it('prefills an untouched share from the market rate', () => {
      expect(
        setPaymentLegAmount({
          leg: { account: cash, amount: 10, currencyCode: 'USD', paymentAmount: 9.2 },
          amount: 35,
          mainCurrencyCode: 'EUR',
          convert,
        }).paymentAmount,
      ).toBe(32.18);
    });

    it('drops back to the market rate once the amount is cleared', () => {
      const cleared = setPaymentLegAmount({ leg: savedCashLeg, amount: null, mainCurrencyCode: 'EUR', convert });
      expect(cleared).toMatchObject({ amount: null, paymentAmount: null, isPaymentAmountEdited: false });
      expect(setPaymentLegAmount({ leg: cleared, amount: 35, mainCurrencyCode: 'EUR', convert }).paymentAmount).toBe(
        32.18,
      );
    });

    it('only changes the amount of a same-currency leg', () => {
      expect(setPaymentLegAmount({ leg: savedLeg, amount: 25, mainCurrencyCode: 'EUR', convert })).toMatchObject({
        amount: 25,
        paymentAmount: 30,
      });
    });
  });

  describe('refreshLegPaymentAmount', () => {
    const newCashLeg: FormPaymentLeg = { account: cash, amount: 35, currencyCode: 'USD' };

    it('prefills the share from the market rate', () => {
      expect(refreshLegPaymentAmount({ leg: newCashLeg, mainCurrencyCode: 'EUR', convert }).paymentAmount).toBe(32.18);
    });

    it('keeps a share the user typed', () => {
      const leg = { ...newCashLeg, amount: 50, paymentAmount: 30, isPaymentAmountEdited: true };
      expect(refreshLegPaymentAmount({ leg, mainCurrencyCode: 'EUR', convert })).toBe(leg);
    });

    it('clears the share while the leg amount is empty', () => {
      expect(
        refreshLegPaymentAmount({
          leg: { ...newCashLeg, amount: null, paymentAmount: 5 },
          mainCurrencyCode: 'EUR',
          convert,
        }).paymentAmount,
      ).toBe(null);
    });

    it('leaves a same-currency leg alone', () => {
      const leg = { account: voucher, amount: 30, currencyCode: 'EUR' };
      expect(refreshLegPaymentAmount({ leg, mainCurrencyCode: 'EUR', convert })).toBe(leg);
    });
  });

  it('throws on an incomplete leg instead of dropping it', () => {
    const complete: FormPaymentLeg = { account: voucher, amount: 30, currencyCode: 'EUR' };
    for (const incomplete of [
      { account: null, amount: 5 },
      { account: card, amount: 0, currencyCode: 'EUR' },
      { account: cash, amount: 35, currencyCode: 'USD', paymentAmount: null },
    ]) {
      expect(() => formLegsToPaymentLegs({ legs: [complete, incomplete], mainCurrencyCode: 'EUR' })).toThrow();
    }
  });

  it('builds the input for created, saved and linked legs', () => {
    expect(
      formLegsToPaymentLegs({
        legs: [
          { account: cash, amount: 35, currencyCode: 'USD', paymentAmount: 30 },
          savedLeg,
          { ...savedLeg, transactionId: 'tx-cash-saved' as RecordId, account: cash, currencyCode: 'USD', amount: 10 },
          linkedCashLeg,
          {
            transactionId: 'tx-linked-eur' as RecordId,
            account: card,
            amount: 12,
            currencyCode: 'EUR',
            isLinked: true,
          },
        ],
        mainCurrencyCode: 'EUR',
      }),
    ).toEqual([
      { accountId: cash.id, amount: 35, paymentAmount: 30 },
      { transactionId: 'tx-leg', amount: 30 },
      { transactionId: 'tx-cash-saved', amount: 10, paymentAmount: 30 },
      { transactionId: 'tx-cash', paymentAmount: 30 },
      { transactionId: 'tx-linked-eur' },
    ]);
  });

  it('sends a leg whose account is unknown by its saved account id', () => {
    const leg = { account: null, accountId: voucher.id, amount: 30, currencyCode: 'EUR' };
    expect(formLegsToPaymentLegs({ legs: [leg], mainCurrencyCode: 'EUR' })).toEqual([
      { accountId: voucher.id, amount: 30 },
    ]);
    expect(isPaymentLegIncomplete({ leg, mainCurrencyCode: 'EUR' })).toBe(false);
  });

  it('requires a positive share for a cross-currency leg', () => {
    expect(isPaymentLegIncomplete({ leg: { ...linkedCashLeg, paymentAmount: 0 }, mainCurrencyCode: 'EUR' })).toBe(true);
    expect(isPaymentLegIncomplete({ leg: linkedCashLeg, mainCurrencyCode: 'EUR' })).toBe(false);
    expect(isPaymentLegIncomplete({ leg: { ...linkedCashLeg, paymentAmount: null }, mainCurrencyCode: 'USD' })).toBe(
      false,
    );
  });

  it('detects a multi-account transaction', () => {
    expect(hasPaymentParts({ transaction: tx({ paymentParts: parts }) })).toBe(true);
    expect(hasPaymentParts({ transaction: tx({ paymentParts: [parts[0]!] }) })).toBe(false);
    expect(hasPaymentParts({ transaction: undefined })).toBe(false);
    expect(hasPaymentParts({ transaction: tx({ paymentParts: parts, paymentParentId: 'tx-main' as RecordId }) })).toBe(
      false,
    );
  });

  describe('resolvePaymentLegsUpdate', () => {
    it('sends the full list while legs are present', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [{ ...savedLeg, amount: 25 }] },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toEqual([{ transactionId: 'tx-leg', amount: 25 }]);
    });

    it('keeps the saved legs when the form still matches them', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [savedLeg] },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toBeUndefined();
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [{ ...savedLeg, account: null }] },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toBeUndefined();
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [linkedCashLeg] },
          transaction: tx({ paymentParts: crossParts }),
        }),
      ).toBeUndefined();
    });

    it('sends the list when a cross-currency share changes', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [{ ...linkedCashLeg, paymentAmount: 31 }] },
          transaction: tx({ paymentParts: crossParts }),
        }),
      ).toEqual([{ transactionId: 'tx-cash', paymentAmount: 31 }]);
    });

    it('resends the legs when the main account switches currency', () => {
      const usdMain = { ...card, id: 'acc-usd' as RecordId, currencyCode: 'USD' } as AccountModel;
      expect(
        resolvePaymentLegsUpdate({
          form: { account: usdMain, paymentLegs: [{ ...savedLeg, paymentAmount: 33 }] },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toEqual([{ transactionId: 'tx-leg', amount: 30, paymentAmount: 33 }]);
    });

    it('sends new and newly linked legs alongside the saved ones', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: {
            account: card,
            paymentLegs: [savedLeg, { account: card, amount: 5, currencyCode: 'EUR' }, linkedCashLeg],
          },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toEqual([
        { transactionId: 'tx-leg', amount: 30 },
        { accountId: card.id, amount: 5 },
        { transactionId: 'tx-cash', paymentAmount: 30 },
      ]);
    });

    it('sends the list when a plain row gains legs', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [{ account: voucher, amount: 30, currencyCode: 'EUR' }] },
          transaction: tx(),
        }),
      ).toEqual([{ accountId: voucher.id, amount: 30 }]);
    });

    it('clears the legs when a saved multi-account row loses them', () => {
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: undefined },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toBe(null);
      expect(
        resolvePaymentLegsUpdate({
          form: { account: card, paymentLegs: [] },
          transaction: tx({ paymentParts: parts }),
        }),
      ).toBe(null);
    });

    it('leaves a plain row untouched', () => {
      expect(
        resolvePaymentLegsUpdate({ form: { account: card, paymentLegs: undefined }, transaction: tx() }),
      ).toBeUndefined();
    });
  });
});
