import { describe, expect, it } from '@jest/globals';

import { normalizeLegacyArchive } from './normalize-legacy-archive';

describe('normalizeLegacyArchive', () => {
  it('drops MCC mappings and clears mcc_rule stamps, keeping other sources', () => {
    const transactions = [
      { id: 1, categorizationMeta: { source: 'mcc_rule', categorizedAt: '2024-01-01' } },
      { id: 2, categorizationMeta: { source: 'manual', categorizedAt: '2024-01-01' } },
      { id: 3, categorizationMeta: null },
    ];
    const parsedByPath = new Map<string, unknown>([
      ['data/transactions.json', transactions],
      ['data/user-merchant-category-codes.json', [{ id: 'x' }]],
    ]);

    normalizeLegacyArchive({ formatVersion: 99, parsedByPath });

    expect(parsedByPath.has('data/user-merchant-category-codes.json')).toBe(false);
    expect(transactions.map((row) => row.categorizationMeta?.source ?? null)).toEqual([null, 'manual', null]);
  });

  it('stamps legacy soft-deleted rows as reconciliation and leaves other rows alone', () => {
    const transactions: Record<string, unknown>[] = [
      { id: 1, deletedAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, deletedAt: '2024-01-01T00:00:00.000Z', deletionReason: 'trash' },
      { id: 3, deletedAt: null, deletionReason: null },
    ];
    const parsedByPath = new Map<string, unknown>([['data/transactions.json', transactions]]);

    normalizeLegacyArchive({ formatVersion: 99, parsedByPath });

    expect(transactions.map((row) => row.deletionReason)).toEqual(['reconciliation', 'trash', null]);
  });
});
