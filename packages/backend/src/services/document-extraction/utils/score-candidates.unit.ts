import { describe, expect, it } from '@jest/globals';

import { type ScoringCandidate, scoreCandidates } from './score-candidates';

const INVOICE = { totalAmount: 100, currencyCode: 'USD', issueDate: '2026-06-10' };
const INVOICE_BASE_AMOUNT = 367;

const candidate = (overrides: Partial<ScoringCandidate> & { id: string }): ScoringCandidate => ({
  amount: 100,
  currencyCode: 'USD',
  refAmount: INVOICE_BASE_AMOUNT,
  originalAmount: null,
  originalCurrencyCode: null,
  time: '2026-06-10T12:00:00.000Z',
  hasAttachment: false,
  hasPayee: true,
  ...overrides,
});

const score = ({
  candidates,
  merchantSimilarityById = {},
  invoiceBaseAmount = INVOICE_BASE_AMOUNT,
  merchantKnown = true,
}: {
  candidates: ScoringCandidate[];
  merchantSimilarityById?: Record<string, number>;
  invoiceBaseAmount?: number | null;
  merchantKnown?: boolean;
}) => scoreCandidates({ invoice: INVOICE, invoiceBaseAmount, candidates, merchantSimilarityById, merchantKnown });

describe('scoreCandidates', () => {
  it('gives a payee-less transaction the full merchant term and labels it unknown', () => {
    const result = score({
      candidates: [
        candidate({ id: 'no-payee', hasPayee: false }),
        candidate({ id: 'other-payee' }),
        candidate({ id: 'no-payee-note-match', hasPayee: false }),
      ],
      merchantSimilarityById: { 'no-payee-note-match': 0.9 },
    });

    const byId = Object.fromEntries(result.map((entry) => [entry.id, entry]));
    expect(byId['no-payee']).toMatchObject({ score: 100, signals: { merchant: 'unknown' } });
    expect(byId['other-payee']).toMatchObject({ score: 75, signals: { merchant: 'none' } });
    expect(byId['no-payee-note-match']!.signals.merchant).toBe('match');
  });

  it('keeps a payee-less note hint at the unknown-merchant score', () => {
    const result = score({
      candidates: [candidate({ id: 'note-hint', hasPayee: false }), candidate({ id: 'no-hint', hasPayee: false })],
      merchantSimilarityById: { 'note-hint': 0.5 },
    });

    const byId = Object.fromEntries(result.map((entry) => [entry.id, entry]));
    // The merchant term stays at the unknown baseline: 0.5 + 0.25 + 0.25.
    expect(byId['note-hint']).toMatchObject({ score: 100, signals: { merchant: 'partial' } });
    expect(byId['no-hint']!.score).toBe(100);
  });

  it.each([
    { similarity: 0.39, merchant: 'none', expected: 85 },
    { similarity: 0.4, merchant: 'partial', expected: 85 },
    { similarity: 0.79, merchant: 'partial', expected: 95 },
    { similarity: 0.8, merchant: 'match', expected: 95 },
  ])('labels a similarity of $similarity as $merchant', ({ similarity, merchant, expected }) => {
    const [scored] = score({
      candidates: [candidate({ id: 'with-payee' })],
      merchantSimilarityById: { 'with-payee': similarity },
    });

    // A payee makes the similarity the merchant term: 0.5 + 0.25 + similarity * 0.25.
    expect(scored).toMatchObject({ score: expected, signals: { merchant } });
  });

  it('ranks an exact same-currency match above a near-miss', () => {
    const result = score({
      candidates: [candidate({ id: 'near', amount: 102 }), candidate({ id: 'exact' })],
      merchantSimilarityById: { near: 1, exact: 1 },
    });

    expect(result.map((entry) => entry.id)).toEqual(['exact', 'near']);
    expect(result[0]).toMatchObject({
      score: 100,
      signals: { amount: 'exact', amountDiff: null, daysFromInvoice: 0, merchant: 'match' },
    });
    expect(result[1]!.signals.amount).toBe('close');
  });

  it('labels a different-currency candidate as converted and caps its amount signal', () => {
    const [converted] = score({
      candidates: [candidate({ id: 'converted', currencyCode: 'EUR', amount: 92 })],
      merchantSimilarityById: { converted: 1 },
    });

    // A perfect base-currency match caps the amount term at 0.9: 0.9 * 0.5 + 0.25 + 0.25.
    expect(converted).toMatchObject({ score: 95, signals: { amount: 'converted', amountDiff: null } });
  });

  it('forgives a bank-markup-sized gap on a converted amount and decays past it', () => {
    const result = score({
      candidates: [
        candidate({ id: 'markup', currencyCode: 'EUR', refAmount: INVOICE_BASE_AMOUNT * 1.03 }),
        candidate({ id: 'far', currencyCode: 'EUR', refAmount: INVOICE_BASE_AMOUNT * 1.044 }),
      ],
      merchantSimilarityById: { markup: 1, far: 1 },
    });

    // 3% is inside the allowance: 0.9 * 0.5 + 0.25 + 0.25. 4.4% is 60% of the way down: 0.36 * 0.5 + 0.5.
    expect(result.map((entry) => [entry.id, entry.score])).toEqual([
      ['markup', 95],
      ['far', 68],
    ]);
  });

  it('compares the original amount when it is in the invoice currency', () => {
    const result = score({
      candidates: [
        candidate({
          id: 'original-exact',
          currencyCode: 'EUR',
          refAmount: INVOICE_BASE_AMOUNT * 1.04,
          originalAmount: 100,
          originalCurrencyCode: 'USD',
        }),
        candidate({
          id: 'original-off',
          currencyCode: 'EUR',
          originalAmount: 102,
          originalCurrencyCode: 'USD',
        }),
      ],
      merchantSimilarityById: { 'original-exact': 1, 'original-off': 1 },
    });

    expect(result[0]).toMatchObject({
      id: 'original-exact',
      score: 100,
      signals: { amount: 'exact', amountDiff: null },
    });
    // 2% off in the invoice's own currency: 0.6 * 0.5 + 0.25 + 0.25.
    expect(result[1]).toMatchObject({ id: 'original-off', score: 80, signals: { amount: 'close', amountDiff: 2 } });
  });

  it('reports an unknown amount signal when the invoice has no base-currency amount', () => {
    const result = score({
      candidates: [candidate({ id: 'unconvertible', currencyCode: 'EUR' })],
      merchantSimilarityById: { unconvertible: 1 },
      invoiceBaseAmount: null,
    });

    expect(result[0]).toMatchObject({ score: 50, signals: { amount: 'unknown', amountDiff: null } });
  });

  it('gives every candidate the full merchant term when the invoice names no counterparty', () => {
    const result = score({
      candidates: [candidate({ id: 'with-payee' }), candidate({ id: 'without-payee', hasPayee: false })],
      merchantKnown: false,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'with-payee',
        score: 100,
        signals: expect.objectContaining({ merchant: 'unknown' }),
      }),
      expect.objectContaining({
        id: 'without-payee',
        score: 100,
        signals: expect.objectContaining({ merchant: 'unknown' }),
      }),
    ]);
  });

  it('reports a signed day offset for a transaction paid before the invoice date', () => {
    const [early] = score({
      candidates: [candidate({ id: 'early', time: '2026-06-03T09:00:00.000Z' })],
      merchantSimilarityById: { early: 1 },
    });

    expect(early!.signals.daysFromInvoice).toBe(-7);
  });

  it('penalises a candidate that already has an attachment', () => {
    const result = score({
      candidates: [candidate({ id: 'attached', hasAttachment: true }), candidate({ id: 'clean' })],
      merchantSimilarityById: { attached: 1, clean: 1 },
    });

    expect(result.map((entry) => entry.id)).toEqual(['clean', 'attached']);
    expect(result).toEqual([expect.objectContaining({ score: 100 }), expect.objectContaining({ score: 90 })]);
  });

  it('drops candidates scoring under the threshold', () => {
    const result = score({
      candidates: [candidate({ id: 'noise', amount: 200, time: '2026-07-09T00:00:00.000Z' })],
    });

    expect(result).toEqual([]);
  });

  it('returns at most five candidates', () => {
    const result = score({
      candidates: Array.from({ length: 8 }, (_, index) => candidate({ id: `tx-${index}`, amount: 100 + index * 0.1 })),
      merchantSimilarityById: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`tx-${index}`, 1])),
    });

    expect(result).toHaveLength(5);
    expect(result.map((entry) => entry.id)).toEqual(['tx-0', 'tx-1', 'tx-2', 'tx-3', 'tx-4']);
  });
});
