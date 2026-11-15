import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';

// A transaction here is a marker in the event log: begin, then commit or rollback.
jest.mock('@services/common/with-transaction', () => ({
  withTransaction:
    <T extends unknown[], R>(fn: (...args: T) => Promise<R>) =>
    async (...args: T): Promise<R> => {
      (globalThis as unknown as { mockProposalEvents: string[] }).mockProposalEvents.push('begin');
      try {
        const result = await fn(...args);
        (globalThis as unknown as { mockProposalEvents: string[] }).mockProposalEvents.push('commit');
        return result;
      } catch (error) {
        (globalThis as unknown as { mockProposalEvents: string[] }).mockProposalEvents.push('rollback');
        throw error;
      }
    },
}));
jest.mock('./parents', () => ({ resolveParents: jest.fn(), loadParentRows: jest.fn() }));
jest.mock('./card-state', () => ({ computeCardState: jest.fn() }));
jest.mock('./to-chat-proposal-card', () => ({
  toChatProposalCard: jest.fn(({ row }: { row: { id: string } }) => ({ id: row.id })),
}));

import { resolveToolPolicy } from '../policies';
import type { ChatToolkitRun } from '../toolkit/types';
import { computeCardState } from './card-state';
import { createProposal } from './create-proposal';
import { loadParentRows, resolveParents } from './parents';

const events: string[] = [];
(globalThis as unknown as { mockProposalEvents: string[] }).mockProposalEvents = events;

const ORIGINAL = '1b4e28ba-2fa1-4d2b-8a5c-3c6f0a9d7e10';
const run = {
  user: { id: 42 },
  threadId: '7c9e6679-7425-4a40-b5a1-9f3d6c2e8b14',
  messageId: '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20',
} as unknown as ChatToolkitRun;
const policy = resolveToolPolicy({ name: 'create_category', args: { name: 'Food' } })!;

const propose = ({ replaces }: { replaces?: string } = {}) =>
  createProposal({ run, policy, args: { name: 'Food' }, meta: { replaces } as never, refs: [], sources: [] });

describe('createProposal', () => {
  const original = { id: ORIGINAL, dependsOn: [] as string[], update: jest.fn(async () => undefined) };
  let originalIsPending: boolean;

  beforeEach(() => {
    events.length = 0;
    originalIsPending = true;
    original.update.mockClear();
    jest.mocked(resolveParents).mockReset().mockResolvedValue([]);
    jest.mocked(loadParentRows).mockReset().mockResolvedValue([]);
    jest
      .mocked(computeCardState)
      .mockReset()
      .mockResolvedValue({
        preview: null,
        error: null,
        snapshot: { baseCurrencyCode: 'USD' },
        confirmation: { mode: 'none' },
      });
    jest.spyOn(ChatProposals, 'findOne').mockImplementation((async ({ lock }: { lock?: boolean }) => {
      events.push(lock ? 'findOne:locked' : 'findOne');
      // A read without the lock may still see the card as pending after an approval started.
      return lock && !originalIsPending ? null : original;
    }) as never);
    jest.spyOn(ChatProposals, 'create').mockImplementation((async (values: { id: string }) => {
      events.push('create');
      return values;
    }) as never);
    original.update.mockImplementation(async () => {
      events.push('supersede');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('supersedes the replaced card under a row lock, in the transaction that stores the replacement', async () => {
    const { replacedCard } = await propose({ replaces: ORIGINAL });

    expect(replacedCard).toEqual({ id: ORIGINAL });
    expect(events).toEqual(['begin', 'findOne:locked', 'create', 'supersede', 'commit']);
    expect(original.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }));
  });

  it('refuses, and stores nothing, when the replaced card stopped being pending before the lock was taken', async () => {
    originalIsPending = false;

    await expect(propose({ replaces: ORIGINAL })).rejects.toMatchObject({
      message: expect.stringContaining('is not a pending proposal'),
    });

    expect(events).toContain('rollback');
    expect(events).not.toContain('create');
    expect(original.update).not.toHaveBeenCalled();
  });

  it('stores a card that replaces nothing without looking for one', async () => {
    const { card, replacedCard } = await propose();

    expect(replacedCard).toBeNull();
    expect(card).toEqual({ id: expect.any(String) });
    expect(events).toEqual(['begin', 'create', 'commit']);
  });
});
