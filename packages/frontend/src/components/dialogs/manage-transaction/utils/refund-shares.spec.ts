import type { TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import type { RefundWithSplit } from '../types';
import {
  type ConvertAmount,
  fillRefundShares,
  finalizeRefundShares,
  getRefundTargetCap,
  refillRefundLinks,
  refillRefundedByLinks,
  refundShareKey,
  validateRefundShares,
} from './refund-shares';

const tx = (id: string) => ({ id }) as TransactionModel;

const purchase = ({
  id,
  amount,
  currencyCode = 'UAH',
  refundedAmount,
  splits,
}: {
  id: string;
  amount: number;
  currencyCode?: string;
  refundedAmount?: number;
  splits?: TransactionModel['splits'];
}) => ({ id, amount, currencyCode, refundedAmount, splits }) as TransactionModel;

// 1 PLN = 26.12 UAH via a UAH base.
const RATES: Record<string, number> = { UAH: 1, PLN: 26.12 };
const convert: ConvertAmount = ({ amount, from, to }) =>
  RATES[from] && RATES[to] ? Math.round(((amount * RATES[from]!) / RATES[to]!) * 100) / 100 : null;

describe('fillRefundShares', () => {
  it('fills in tick order, each target capped by what is left of it', () => {
    expect(
      fillRefundShares({
        refundAmount: 100,
        targets: [{ cap: 30 }, { cap: 50 }, { cap: 40 }],
      }),
    ).toEqual([30, 50, 20]);
  });

  it('gives zero once the refund is used up', () => {
    expect(fillRefundShares({ refundAmount: 20, targets: [{ cap: 30 }, { cap: 10 }] })).toEqual([20, 0]);
  });

  it('caps a partly refunded purchase by its remainder, not its amount', () => {
    const { cap } = getRefundTargetCap({
      link: { transaction: purchase({ id: 'a', amount: 100, refundedAmount: 60 }) },
      refundCurrencyCode: 'UAH',
      convert,
    });
    expect(cap).toBe(40);
    expect(fillRefundShares({ refundAmount: 100, targets: [{ cap }] })).toEqual([40]);
  });

  it('keeps preset shares and fills the rest from what is left', () => {
    expect(
      fillRefundShares({
        refundAmount: 100,
        targets: [{ cap: 80, share: 25 }, { cap: 90 }],
      }),
    ).toEqual([25, 75]);
  });

  it('lets an unbounded target take everything left', () => {
    expect(fillRefundShares({ refundAmount: 99.99, targets: [{ cap: 40 }, { cap: null }] })).toEqual([40, 59.99]);
  });

  it('gives the last rate-estimated target the exact remainder instead of an orphan cent', () => {
    expect(
      fillRefundShares({
        refundAmount: 100,
        targets: [
          { cap: 33.33, isCapApprox: true },
          { cap: 33.33, isCapApprox: true },
          { cap: 33.33, isCapApprox: true },
        ],
      }),
    ).toEqual([33.33, 33.33, 33.34]);
  });

  it('leaves a same-currency remainder unassigned', () => {
    expect(fillRefundShares({ refundAmount: 100, targets: [{ cap: 99.99 }] })).toEqual([99.99]);
  });

  it('returns zero shares when nothing of the refund is left', () => {
    expect(fillRefundShares({ refundAmount: 50, targets: [{ cap: 80, share: 50 }, { cap: 20 }] })).toEqual([50, 0]);
  });
});

describe('getRefundTargetCap', () => {
  it('does not count this refund’s own saved share as refunded by others', () => {
    const result = getRefundTargetCap({
      link: { transaction: purchase({ id: 'a', amount: 100, refundedAmount: 70 }) },
      refundCurrencyCode: 'UAH',
      savedShares: { [refundShareKey({ txId: 'a' })]: 30 },
      convert,
    });
    expect(result).toMatchObject({ cap: 60, isSameCurrency: true, isCapApprox: false, refundedByOthers: 40 });
  });

  it('treats an unknown refunded amount as nothing refunded yet', () => {
    expect(
      getRefundTargetCap({
        link: { transaction: purchase({ id: 'a', amount: 100 }) },
        refundCurrencyCode: 'UAH',
        savedShares: { [refundShareKey({ txId: 'a' })]: 30 },
        convert,
      }).cap,
    ).toBe(100);
  });

  it('uses the split amount for a split target', () => {
    const transaction = purchase({
      id: 'a',
      amount: 100,
      splits: [{ id: 's1', amount: 25, refundedAmount: 5 }] as TransactionModel['splits'],
    });
    expect(getRefundTargetCap({ link: { transaction, splitId: 's1' }, refundCurrencyCode: 'UAH', convert }).cap).toBe(
      20,
    );
  });

  it('caps the main part of a split purchase by what is left of the whole purchase', () => {
    const transaction = purchase({
      id: 'a',
      amount: 100,
      refundedAmount: 30,
      splits: [{ id: 's1', amount: 40, refundedAmount: 30 }] as TransactionModel['splits'],
    });
    expect(getRefundTargetCap({ link: { transaction }, refundCurrencyCode: 'UAH', convert }).cap).toBe(70);
  });

  it('caps a split target by what is left of the whole purchase', () => {
    const transaction = purchase({
      id: 'a',
      amount: 100,
      refundedAmount: 80,
      splits: [{ id: 's1', amount: 40, refundedAmount: 0 }] as TransactionModel['splits'],
    });
    expect(
      getRefundTargetCap({ link: { transaction, splitId: 's1' }, refundCurrencyCode: 'UAH', convert }),
    ).toMatchObject({ cap: 20, purchaseAmount: 40, refundedByOthers: 20 });
  });

  it('frees the whole saved share of a purchase when it is re-picked on a different split', () => {
    const transaction = purchase({
      id: 'p',
      amount: 60,
      refundedAmount: 50,
      splits: [{ id: 's1', amount: 40, refundedAmount: 0 }] as TransactionModel['splits'],
    });
    expect(
      getRefundTargetCap({
        link: { transaction, splitId: 's1' },
        refundCurrencyCode: 'UAH',
        savedShares: { [refundShareKey({ txId: 'p' })]: 50 },
        convert,
      }).cap,
    ).toBe(40);
  });

  it('frees a saved split share when the main line of that purchase is picked', () => {
    const transaction = purchase({
      id: 'p',
      amount: 100,
      refundedAmount: 40,
      splits: [{ id: 's1', amount: 40, refundedAmount: 40 }] as TransactionModel['splits'],
    });
    expect(
      getRefundTargetCap({
        link: { transaction },
        refundCurrencyCode: 'UAH',
        savedShares: { [refundShareKey({ txId: 'p', splitId: 's1' })]: 40 },
        convert,
      }).cap,
    ).toBe(100);
  });

  it('frees only the picked split’s own saved share at the split level', () => {
    const transaction = purchase({
      id: 'p',
      amount: 100,
      refundedAmount: 70,
      splits: [
        { id: 's1', amount: 40, refundedAmount: 40 },
        { id: 's2', amount: 30, refundedAmount: 30 },
      ] as TransactionModel['splits'],
    });
    expect(
      getRefundTargetCap({
        link: { transaction, splitId: 's1' },
        refundCurrencyCode: 'UAH',
        savedShares: { [refundShareKey({ txId: 'p', splitId: 's2' })]: 30 },
        convert,
      }).cap,
    ).toBe(0);
  });

  it('converts a cross-currency purchase remainder into the refund currency', () => {
    expect(
      getRefundTargetCap({
        link: { transaction: purchase({ id: 'a', amount: 25, currencyCode: 'PLN' }) },
        refundCurrencyCode: 'UAH',
        convert,
      }),
    ).toMatchObject({ cap: 653, isCapApprox: true, isSameCurrency: false });
  });

  it('has no cap when the rate is missing', () => {
    expect(
      getRefundTargetCap({
        link: { transaction: purchase({ id: 'a', amount: 25, currencyCode: 'EUR' }) },
        refundCurrencyCode: 'UAH',
        convert,
      }).cap,
    ).toBeNull();
  });

  it('keeps a tiny cross-currency remainder tickable with a one-cent cap', () => {
    expect(
      getRefundTargetCap({
        link: { transaction: purchase({ id: 'a', amount: 0.01, currencyCode: 'PLN' }) },
        refundCurrencyCode: 'USD',
        convert: () => 0.0018,
      }),
    ).toMatchObject({ cap: 0.01, isCapApprox: true });
  });

  it('caps a fully refunded cross-currency purchase at zero', () => {
    expect(
      getRefundTargetCap({
        link: { transaction: purchase({ id: 'a', amount: 25, currencyCode: 'PLN', refundedAmount: 25 }) },
        refundCurrencyCode: 'UAH',
        convert,
      }).cap,
    ).toBe(0);
  });
});

describe('refillRefundLinks', () => {
  it('refills app-filled shares and keeps adjusted ones', () => {
    const links: RefundWithSplit[] = [
      { transaction: purchase({ id: 'a', amount: 300 }), amount: 50, isAdjusted: true },
      { transaction: purchase({ id: 'b', amount: 300 }), amount: 10, isAdjusted: false },
      { transaction: purchase({ id: 'c', amount: 25, currencyCode: 'PLN' }), amount: null },
    ];
    expect(
      refillRefundLinks({ links, refundAmount: 1000, refundCurrencyCode: 'UAH', savedShares: {}, convert }).map(
        (link) => link.amount,
      ),
    ).toEqual([50, 300, 650]);
  });

  it('keeps a saved partial share and refills a saved whole-refund link', () => {
    const links: RefundWithSplit[] = [
      { transaction: purchase({ id: 'a', amount: 300 }), amount: 40 },
      { transaction: purchase({ id: 'b', amount: 300 }), amount: null },
    ];
    expect(
      refillRefundLinks({ links, refundAmount: 100, refundCurrencyCode: 'UAH', savedShares: {}, convert }).map(
        (link) => link.amount,
      ),
    ).toEqual([40, 60]);
  });

  it('offsets a split link by its own saved share, looked up per target', () => {
    const transaction = purchase({
      id: 'a',
      amount: 100,
      refundedAmount: 40,
      splits: [{ id: 's1', amount: 40, refundedAmount: 40 }] as TransactionModel['splits'],
    });
    expect(
      refillRefundLinks({
        links: [{ transaction, splitId: 's1', amount: null }],
        refundAmount: 40,
        refundCurrencyCode: 'UAH',
        savedShares: { [refundShareKey({ txId: 'a', splitId: 's1' })]: 40, [refundShareKey({ txId: 'a' })]: 0 },
        convert,
      }).map((link) => link.amount),
    ).toEqual([40]);
  });
});

describe('refillRefundedByLinks', () => {
  const income = ({ id, amount, currencyCode = 'UAH' }: { id: string; amount: number; currencyCode?: string }) =>
    ({ id, amount, currencyCode }) as TransactionModel;

  it('caps a refund bigger than the purchase at what is left of the purchase', () => {
    const links: RefundWithSplit[] = [
      { transaction: income({ id: 'r1', amount: 1500 }), amount: 1500 },
      { transaction: income({ id: 'r2', amount: 6800 }), isAdjusted: false },
    ];
    expect(
      refillRefundedByLinks({ links, purchaseAmount: 2000, purchaseCurrencyCode: 'UAH' }).map((link) => link.amount),
    ).toEqual([1500, 500]);
  });

  it('links a freshly ticked cross-currency refund whole and leaves saved links alone', () => {
    const links: RefundWithSplit[] = [
      { transaction: income({ id: 'r1', amount: 90, currencyCode: 'PLN' }), isAdjusted: false, amount: 12 },
      { transaction: income({ id: 'r2', amount: 30, currencyCode: 'PLN' }), amount: null },
    ];
    expect(
      refillRefundedByLinks({ links, purchaseAmount: 2000, purchaseCurrencyCode: 'UAH' }).map((link) => link.amount),
    ).toEqual([undefined, null]);
  });
});

describe('validateRefundShares', () => {
  it('accepts shares within the refund and the purchase remainders', () => {
    const result = validateRefundShares({
      refundAmount: 100,
      targets: [
        { share: 30, cap: 30, isSameCurrency: true },
        { share: 70, cap: 80, isSameCurrency: false },
      ],
    });
    expect(result).toEqual({
      assigned: 100,
      errors: [null, null],
      warnings: [false, false],
      isOverAssigned: false,
      isValid: true,
    });
  });

  it('accepts a partial assignment below the refund amount', () => {
    expect(
      validateRefundShares({ refundAmount: 100, targets: [{ share: 40, cap: 50, isSameCurrency: true }] }).isValid,
    ).toBe(true);
  });

  it('rejects a total above the refund amount', () => {
    const result = validateRefundShares({
      refundAmount: 100,
      targets: [
        { share: 60, cap: 60, isSameCurrency: true },
        { share: 40.01, cap: 50, isSameCurrency: true },
      ],
    });
    expect(result.isOverAssigned).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it('rejects a same-currency share above what is left of the purchase', () => {
    const result = validateRefundShares({
      refundAmount: 100,
      targets: [{ share: 60, cap: 50, isSameCurrency: true }],
    });
    expect(result.errors).toEqual(['exceedsPurchase']);
    expect(result.isValid).toBe(false);
  });

  it('only warns about a cross-currency share above the converted purchase', () => {
    const result = validateRefundShares({
      refundAmount: 100,
      targets: [{ share: 60, cap: 5, isSameCurrency: false }],
    });
    expect(result.errors).toEqual([null]);
    expect(result.warnings).toEqual([true]);
    expect(result.isValid).toBe(true);
  });

  it.each([0, null, -5])('rejects a share of %s', (share) => {
    const result = validateRefundShares({
      refundAmount: 100,
      targets: [{ share, cap: 50, isSameCurrency: true }],
    });
    expect(result.errors).toEqual(['nonPositive']);
    expect(result.isValid).toBe(false);
  });
});

describe('finalizeRefundShares', () => {
  it('stores a single whole-refund target as amount null', () => {
    expect(finalizeRefundShares({ refundAmount: 100, links: [{ transaction: tx('a'), amount: 100 }] })).toEqual([
      { transaction: tx('a'), amount: null },
    ]);
  });

  it('keeps a single partial share', () => {
    const links = [{ transaction: tx('a'), amount: 40 }];
    expect(finalizeRefundShares({ refundAmount: 100, links })).toBe(links);
  });

  it('keeps every share when several targets are linked', () => {
    const links = [
      { transaction: tx('a'), amount: 60 },
      { transaction: tx('b'), amount: 40 },
    ];
    expect(finalizeRefundShares({ refundAmount: 100, links })).toBe(links);
  });
});
