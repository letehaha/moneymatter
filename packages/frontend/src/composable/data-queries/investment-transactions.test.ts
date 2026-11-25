import type { HoldingTransactionsResponse } from '@/api/investment-transactions';
import type { InvestmentTransactionModel } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';

import { fetchAllTransactionPages } from './investment-transactions';

const rows = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, index) => ({ id: String(index) }) as unknown as InvestmentTransactionModel);

/** Serves `all` in pages of `limit` at `offset`, reporting `total`. */
const serve = ({ all, total = all.length }: { all: InvestmentTransactionModel[]; total?: unknown }) =>
  vi.fn(
    async ({ limit, offset }: { limit: number; offset: number }) =>
      ({ transactions: all.slice(offset, offset + limit), total, limit, offset }) as HoldingTransactionsResponse,
  );

describe('fetchAllTransactionPages', () => {
  it('pages through more rows than one page holds', async () => {
    const fetchPage = serve({ all: rows({ count: 250 }) });

    const transactions = await fetchAllTransactionPages({ fetchPage, pageSize: 100 });

    expect(transactions).toHaveLength(250);
    expect(fetchPage.mock.calls.map(([args]) => args.offset)).toEqual([0, 100, 200]);
  });

  it('advances the offset by the rows received when the server returns short pages', async () => {
    const all = rows({ count: 120 });
    const fetchPage = vi.fn(
      async ({ offset }: { limit: number; offset: number }) =>
        ({
          transactions: all.slice(offset, offset + 50),
          total: all.length,
          limit: 50,
          offset,
        }) as HoldingTransactionsResponse,
    );

    expect(await fetchAllTransactionPages({ fetchPage, pageSize: 100 })).toHaveLength(120);
    expect(fetchPage.mock.calls.map(([args]) => args.offset)).toEqual([0, 50, 100]);
  });

  it('stops after the last full page when the total is an exact multiple', async () => {
    const fetchPage = serve({ all: rows({ count: 200 }) });

    expect(await fetchAllTransactionPages({ fetchPage, pageSize: 100 })).toHaveLength(200);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('returns nothing for a holding without transactions', async () => {
    expect(await fetchAllTransactionPages({ fetchPage: serve({ all: [] }), pageSize: 100 })).toEqual([]);
  });

  it('throws when the pages run dry before the reported total', async () => {
    const fetchPage = serve({ all: rows({ count: 100 }), total: 150 });

    await expect(fetchAllTransactionPages({ fetchPage, pageSize: 100 })).rejects.toThrow(
      'Holding transactions ended before the reported total',
    );
  });

  it('throws when a page has no numeric total', async () => {
    const fetchPage = serve({ all: rows({ count: 5 }), total: null });

    await expect(fetchAllTransactionPages({ fetchPage, pageSize: 100 })).rejects.toThrow(
      'Holding transactions page is missing its total',
    );
  });
});
