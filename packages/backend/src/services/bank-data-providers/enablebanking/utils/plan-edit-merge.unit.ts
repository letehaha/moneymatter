import { CATEGORIZATION_SOURCE, type CategorizationMeta, PAYMENT_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { EditMergeSide, planEditMerge } from './plan-edit-merge';

const DEFAULT_CATEGORY_ID = 'category-default';
const SYNC_NOTE = 'ACME STORE PURCHASE';
const NOW = new Date('2026-05-01T12:00:00.000Z');

const MANUAL: CategorizationMeta = { source: CATEGORIZATION_SOURCE.manual, categorizedAt: '2026-01-01T00:00:00.000Z' };
const AI: CategorizationMeta = { source: CATEGORIZATION_SOURCE.ai, categorizedAt: '2026-01-01T00:00:00.000Z' };
const PAYEE_RULE: CategorizationMeta = { source: CATEGORIZATION_SOURCE.payeeRule };
const SYNTHESIZED_MANUAL: CategorizationMeta = {
  source: CATEGORIZATION_SOURCE.manual,
  categorizedAt: NOW.toISOString(),
};

function side(overrides: Partial<EditMergeSide> = {}): EditMergeSide {
  return {
    note: SYNC_NOTE,
    categoryId: DEFAULT_CATEGORY_ID,
    paymentType: PAYMENT_TYPES.bankTransfer,
    payeeId: null,
    payeeLocked: false,
    categorizationMeta: null,
    ...overrides,
  };
}

function plan({
  orphan,
  canonical,
  orphanSyncNote = SYNC_NOTE,
  canonicalSyncNote = SYNC_NOTE,
  defaultPaymentType = null,
}: {
  orphan: EditMergeSide;
  canonical: EditMergeSide;
  orphanSyncNote?: string | null;
  canonicalSyncNote?: string | null;
  defaultPaymentType?: PAYMENT_TYPES | null;
}) {
  return planEditMerge({
    orphan,
    canonical,
    orphanSyncNote,
    canonicalSyncNote,
    defaultCategoryId: DEFAULT_CATEGORY_ID,
    defaultPaymentType,
    now: NOW,
  });
}

describe('planEditMerge – note', () => {
  it('moves nothing when neither side was edited', () => {
    const result = plan({ orphan: side(), canonical: side() });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves the orphan note when only the orphan was edited', () => {
    const result = plan({ orphan: side({ note: 'Birthday gift' }), canonical: side() });

    expect(result).toEqual({ action: 'merge', valuesToMove: { note: 'Birthday gift' } });
  });

  it('keeps the canonical note when only the canonical was edited', () => {
    const result = plan({ orphan: side(), canonical: side({ note: 'Birthday gift' }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves nothing when both sides carry the same note', () => {
    const result = plan({ orphan: side({ note: 'Birthday gift' }), canonical: side({ note: 'Birthday gift' }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('skips when both sides were edited to different notes', () => {
    const result = plan({ orphan: side({ note: 'Birthday gift' }), canonical: side({ note: 'Groceries' }) });

    expect(result).toEqual({ action: 'skip', reason: 'note_conflict' });
  });

  it('treats an empty orphan note as not edited', () => {
    const result = plan({ orphan: side({ note: '' }), canonical: side({ note: 'Groceries' }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('treats a null orphan note as not edited', () => {
    const result = plan({ orphan: side({ note: null }), canonical: side({ note: 'Groceries' }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('compares each side against its own sync baseline', () => {
    const result = plan({
      orphan: side({ note: 'PENDING ACME' }),
      canonical: side({ note: 'BOOKED ACME' }),
      orphanSyncNote: 'PENDING ACME',
      canonicalSyncNote: 'BOOKED ACME',
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('treats any orphan note as edited when the orphan has no stored sync note', () => {
    const result = plan({
      orphan: side({ note: SYNC_NOTE }),
      canonical: side({ note: '' }),
      orphanSyncNote: null,
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { note: SYNC_NOTE } });
  });

  it('skips when neither side has a stored sync note and the notes differ', () => {
    const result = plan({
      orphan: side({ note: 'PENDING ACME' }),
      canonical: side({ note: 'BOOKED ACME' }),
      orphanSyncNote: null,
      canonicalSyncNote: null,
    });

    expect(result).toEqual({ action: 'skip', reason: 'note_conflict' });
  });
});

describe('planEditMerge – category', () => {
  it('moves a manually categorized orphan category together with its stamp', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
      canonical: side(),
    });

    expect(result).toEqual({
      action: 'merge',
      valuesToMove: { categoryId: 'category-groceries', categorizationMeta: MANUAL },
    });
  });

  it('keeps the canonical category when only the canonical was edited', () => {
    const result = plan({
      orphan: side(),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('never overwrites a manual canonical stamp with a weaker orphan stamp', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: AI }),
      canonical: side({ categoryId: 'category-travel', categorizationMeta: MANUAL }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves nothing when both sides share the same category and stamp strength', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('skips when both sides were manually categorized differently', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
      canonical: side({ categoryId: 'category-travel', categorizationMeta: MANUAL }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'category_conflict' });
  });

  it('does not treat an AI-categorized orphan as a user edit', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: AI }),
      canonical: side(),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('does not treat a payee-rule categorized orphan as a user edit', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: PAYEE_RULE }),
      canonical: side(),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('merges instead of skipping when both sides were categorized by AI', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: AI }),
      canonical: side({ categoryId: 'category-travel', categorizationMeta: AI }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('synthesizes a manual stamp when moving a category from a stampless orphan', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: null }),
      canonical: side(),
    });

    expect(result).toEqual({
      action: 'merge',
      valuesToMove: { categoryId: 'category-groceries', categorizationMeta: SYNTHESIZED_MANUAL },
    });
  });

  it('reports a plain category conflict when at least one side carries a manual stamp', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: null }),
      canonical: side({ categoryId: 'category-travel', categorizationMeta: MANUAL }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'category_conflict' });
  });

  it('reports a legacy category conflict when only the stampless heuristic fired', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: null }),
      canonical: side({ categoryId: 'category-travel', categorizationMeta: null }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'legacy_category_conflict' });
  });

  it('moves a manual orphan stamp onto an unstamped canonical sharing the category', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: null }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { categorizationMeta: MANUAL } });
  });

  it('upgrades an AI stamp on the canonical to the orphan manual stamp for the same category', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: MANUAL }),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: AI }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { categorizationMeta: MANUAL } });
  });

  it('leaves the canonical stamp alone when the orphan stamp is not manual', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: AI }),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: null }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('does not synthesize a stamp for a stampless orphan sharing the canonical category', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: null }),
      canonical: side({ categoryId: 'category-groceries', categorizationMeta: null }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  // A stamp object with no readable source is treated as "stamped by something that
  // is not the user": the stampless heuristic never runs, so no category moves.
  it('treats an empty stamp object as a non-manual stamp', () => {
    const result = plan({
      orphan: side({ categoryId: 'category-groceries', categorizationMeta: {} as CategorizationMeta }),
      canonical: side(),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('treats an undefined stamp source as a non-manual stamp', () => {
    const result = plan({
      orphan: side({
        categoryId: 'category-groceries',
        categorizationMeta: { source: undefined } as unknown as CategorizationMeta,
      }),
      canonical: side(),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });
});

describe('planEditMerge – paymentType', () => {
  it('moves the orphan payment type when only the orphan was edited', () => {
    const result = plan({ orphan: side({ paymentType: PAYMENT_TYPES.cash }), canonical: side() });

    expect(result).toEqual({ action: 'merge', valuesToMove: { paymentType: PAYMENT_TYPES.cash } });
  });

  it('keeps the canonical payment type when only the canonical was edited', () => {
    const result = plan({ orphan: side(), canonical: side({ paymentType: PAYMENT_TYPES.cash }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves nothing when both sides share the same payment type', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.cash }),
      canonical: side({ paymentType: PAYMENT_TYPES.cash }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('skips when both sides were edited to different payment types', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.cash }),
      canonical: side({ paymentType: PAYMENT_TYPES.creditCard }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'payment_type_conflict' });
  });
});

describe('planEditMerge – paymentType with an account default', () => {
  const defaultPaymentType = PAYMENT_TYPES.cash;

  it('moves nothing when both sides carry the account default', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.cash }),
      canonical: side({ paymentType: PAYMENT_TYPES.cash }),
      defaultPaymentType,
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('does not treat a stale bankTransfer orphan as a user edit', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.bankTransfer }),
      canonical: side({ paymentType: PAYMENT_TYPES.cash }),
      defaultPaymentType,
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves an orphan payment type that differs from both sync values', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.debitCard }),
      canonical: side({ paymentType: PAYMENT_TYPES.cash }),
      defaultPaymentType,
    });

    expect(result).toEqual({
      action: 'merge',
      valuesToMove: { paymentType: PAYMENT_TYPES.debitCard },
    });
  });

  it('skips when both sides differ from the sync values', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.debitCard }),
      canonical: side({ paymentType: PAYMENT_TYPES.creditCard }),
      defaultPaymentType,
    });

    expect(result).toEqual({ action: 'skip', reason: 'payment_type_conflict' });
  });
});

describe('planEditMerge – payee', () => {
  it('moves nothing when neither side is locked', () => {
    const result = plan({ orphan: side({ payeeId: 'payee-a' }), canonical: side({ payeeId: 'payee-b' }) });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves the locked orphan payee onto an unlocked canonical', () => {
    const result = plan({
      orphan: side({ payeeId: 'payee-a', payeeLocked: true }),
      canonical: side({ payeeId: 'payee-b' }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { payeeId: 'payee-a', payeeLocked: true } });
  });

  it('moves the lock onto an unlocked canonical that already holds the same payee', () => {
    const result = plan({
      orphan: side({ payeeId: 'payee-a', payeeLocked: true }),
      canonical: side({ payeeId: 'payee-a' }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { payeeId: 'payee-a', payeeLocked: true } });
  });

  it('moves a deliberately cleared payee onto an unlocked canonical', () => {
    const result = plan({
      orphan: side({ payeeId: null, payeeLocked: true }),
      canonical: side({ payeeId: 'payee-b' }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: { payeeId: null, payeeLocked: true } });
  });

  it('keeps the canonical payee when only the canonical is locked', () => {
    const result = plan({
      orphan: side({ payeeId: 'payee-a' }),
      canonical: side({ payeeId: 'payee-b', payeeLocked: true }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('moves nothing when both sides are locked to the same payee', () => {
    const result = plan({
      orphan: side({ payeeId: 'payee-a', payeeLocked: true }),
      canonical: side({ payeeId: 'payee-a', payeeLocked: true }),
    });

    expect(result).toEqual({ action: 'merge', valuesToMove: {} });
  });

  it('skips when both sides are locked to different payees', () => {
    const result = plan({
      orphan: side({ payeeId: 'payee-a', payeeLocked: true }),
      canonical: side({ payeeId: 'payee-b', payeeLocked: true }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'payee_conflict' });
  });
});

describe('planEditMerge – combined', () => {
  it('collects every orphan edit in one merge plan', () => {
    const result = plan({
      orphan: side({
        note: 'Birthday gift',
        categoryId: 'category-gifts',
        categorizationMeta: MANUAL,
        paymentType: PAYMENT_TYPES.cash,
        payeeId: 'payee-a',
        payeeLocked: true,
      }),
      canonical: side(),
    });

    expect(result).toEqual({
      action: 'merge',
      valuesToMove: {
        note: 'Birthday gift',
        categoryId: 'category-gifts',
        categorizationMeta: MANUAL,
        paymentType: PAYMENT_TYPES.cash,
        payeeId: 'payee-a',
        payeeLocked: true,
      },
    });
  });

  it('reports the first conflicting field and stops', () => {
    const result = plan({
      orphan: side({ note: 'Birthday gift', paymentType: PAYMENT_TYPES.cash }),
      canonical: side({ note: 'Groceries', paymentType: PAYMENT_TYPES.creditCard }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'note_conflict' });
  });

  it('reports the category conflict when the payee also conflicts', () => {
    const result = plan({
      orphan: side({
        categoryId: 'category-groceries',
        categorizationMeta: MANUAL,
        payeeId: 'payee-a',
        payeeLocked: true,
      }),
      canonical: side({
        categoryId: 'category-travel',
        categorizationMeta: MANUAL,
        payeeId: 'payee-b',
        payeeLocked: true,
      }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'category_conflict' });
  });

  it('reports the payment type conflict when the payee also conflicts', () => {
    const result = plan({
      orphan: side({ paymentType: PAYMENT_TYPES.cash, payeeId: 'payee-a', payeeLocked: true }),
      canonical: side({ paymentType: PAYMENT_TYPES.creditCard, payeeId: 'payee-b', payeeLocked: true }),
    });

    expect(result).toEqual({ action: 'skip', reason: 'payment_type_conflict' });
  });
});
