import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// The real models open database connections when imported.
jest.mock('@models/transactions-query', () => ({ findOneTransaction: jest.fn(), findTransactions: jest.fn() }));
jest.mock('@models/chat-proposals.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));

import ChatProposals from '@models/chat-proposals.model';
import { findOneTransaction, findTransactions } from '@models/transactions-query';

import { ToolInputError } from './placeholders';
import { assertNoTwinLegUpdate, repeatsSharedFields } from './twin-leg-update';

describe('repeatsSharedFields', () => {
  it('repeats when every shared field is the same on the other leg, an instant written another way included', () => {
    expect(
      repeatsSharedFields({
        args: { id: 'leg-b', time: '2026-10-29T14:05:00.000Z', note: 'Exchange' },
        pending: { id: 'leg-a', time: '2026-10-29T18:05:00+04:00', note: 'Exchange', amount: 5 },
      }),
    ).toBe(true);
  });

  it('does not repeat when a field differs or the other card leaves one out', () => {
    expect(
      repeatsSharedFields({
        args: { id: 'b', time: '2026-10-29T14:05:00Z' },
        pending: { id: 'a', time: '2026-10-29T11:00:00Z' },
      }),
    ).toBe(false);
    expect(
      repeatsSharedFields({
        args: { id: 'b', time: '2026-10-29T14:05:00Z', note: 'x' },
        pending: { id: 'a', time: '2026-10-29T14:05:00Z' },
      }),
    ).toBe(false);
  });

  it('does not repeat an edit that sets no shared field, such as an amount change on one leg', () => {
    expect(repeatsSharedFields({ args: { id: 'b', amount: 5 }, pending: { id: 'a', amount: 5 } })).toBe(false);
  });
});

describe('assertNoTwinLegUpdate', () => {
  const run = (args: Record<string, unknown>) => assertNoTwinLegUpdate({ userId: 1, threadId: 't1', args });
  const leg = { id: 'leg-b', transferId: 'tr1', transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(findOneTransaction).mockResolvedValue(leg as never);
    jest.mocked(findTransactions).mockResolvedValue([{ id: 'leg-a' }] as never);
  });

  it('refuses the same edit for the other leg while a card for the first leg is pending, and names that card', async () => {
    jest
      .mocked(ChatProposals.findAll)
      .mockResolvedValue([{ id: 'card-a', args: { id: 'leg-a', time: '2026-10-29T14:05:00.000Z' } }] as never);

    await expect(run({ id: 'leg-b', time: '2026-10-29T14:05:00.000Z' })).rejects.toThrow(ToolInputError);
    await expect(run({ id: 'leg-b', time: '2026-10-29T14:05:00.000Z' })).rejects.toThrow(/card-a/);
  });

  it('allows a different edit for the other leg', async () => {
    jest
      .mocked(ChatProposals.findAll)
      .mockResolvedValue([{ id: 'card-a', args: { id: 'leg-a', time: '2026-10-29T14:05:00.000Z' } }] as never);

    await expect(run({ id: 'leg-b', time: '2026-10-29T11:00:00.000Z' })).resolves.toBeUndefined();
  });

  it('allows the first card, a transaction that is not a transfer, and an edit of fields only one leg has', async () => {
    jest.mocked(ChatProposals.findAll).mockResolvedValue([]);
    await expect(run({ id: 'leg-b', time: '2026-10-29T14:05:00.000Z' })).resolves.toBeUndefined();

    jest
      .mocked(findOneTransaction)
      .mockResolvedValue({ id: 'x', transferId: null, transferNature: 'not_transfer' } as never);
    await expect(run({ id: 'x', time: '2026-10-29T14:05:00.000Z' })).resolves.toBeUndefined();

    await expect(run({ id: 'leg-b', amount: 5 })).resolves.toBeUndefined();
    expect(ChatProposals.findAll).toHaveBeenCalledTimes(1);
  });
});
