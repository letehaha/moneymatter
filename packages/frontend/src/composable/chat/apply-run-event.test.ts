import type { ChatProposalCard, ChatRunEvent } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { type ChatRunState, applyRunEvent, createRunState } from './apply-run-event';

const card = ({ id, status = 'pending' }: { id: string; status?: ChatProposalCard['status'] }) =>
  ({ id, status, revision: 1, toolName: 'create_category' }) as ChatProposalCard;

const apply = ({ events, state }: { events: ChatRunEvent[]; state?: ChatRunState }) =>
  events.reduce(
    (current, event) => applyRunEvent({ state: current, event }),
    state ?? createRunState({ runId: 'run-1', messageId: 'msg-1' }),
  );

describe('applyRunEvent', () => {
  it('records the provider and model of the run', () => {
    const state = apply({
      events: [{ type: 'run.started', runId: 'run-1', messageId: 'msg-1', provider: 'openai', modelId: 'gpt-x' }],
    });

    expect(state).toMatchObject({ provider: 'openai', modelId: 'gpt-x', status: 'streaming' });
  });

  it('appends started parts in order and replaces a part that is announced twice', () => {
    const state = apply({
      events: [
        { type: 'part.started', part: { type: 'text', id: 'a', text: '' } },
        { type: 'part.started', part: { type: 'proposal', id: 'b', proposalId: 'p1' } },
        { type: 'part.started', part: { type: 'text', id: 'a', text: 'again' } },
      ],
    });

    expect(state.parts).toEqual([
      { type: 'text', id: 'a', text: 'again' },
      { type: 'proposal', id: 'b', proposalId: 'p1' },
    ]);
  });

  it('appends text deltas to their part and ignores a delta for an unknown part', () => {
    const state = apply({
      events: [
        { type: 'part.started', part: { type: 'text', id: 'a', text: '' } },
        { type: 'text.delta', partId: 'a', delta: 'Hel' },
        { type: 'text.delta', partId: 'a', delta: 'lo' },
        { type: 'text.delta', partId: 'missing', delta: 'lost' },
      ],
    });

    expect(state.parts).toEqual([{ type: 'text', id: 'a', text: 'Hello' }]);
  });

  it('removes the parts a retraction names and keeps the others', () => {
    const state = apply({
      events: [
        { type: 'part.started', part: { type: 'text', id: 'a', text: 'thinking out loud' } },
        { type: 'part.started', part: { type: 'text', id: 'b', text: 'more' } },
        { type: 'part.started', part: { type: 'proposal', id: 'c', proposalId: 'p1' } },
        { type: 'text.retracted', partIds: ['a', 'b'] },
      ],
    });

    expect(state.parts).toEqual([{ type: 'proposal', id: 'c', proposalId: 'p1' }]);
  });

  it('merges a part patch into the part', () => {
    const state = apply({
      events: [
        {
          type: 'part.started',
          part: { type: 'toolCall', id: 't', callId: 'c1', toolName: 'get_accounts', args: {}, status: 'running' },
        },
        { type: 'part.updated', partId: 't', patch: { status: 'ok', durationMs: 12 } },
        { type: 'part.updated', partId: 'missing', patch: { status: 'error' } },
      ],
    });

    expect(state.parts[0]).toMatchObject({ id: 't', toolName: 'get_accounts', status: 'ok', durationMs: 12 });
    expect(state.parts).toHaveLength(1);
  });

  it('keeps the latest card by id', () => {
    const state = apply({
      events: [
        { type: 'proposal.upserted', card: card({ id: 'p1' }) },
        { type: 'proposal.upserted', card: card({ id: 'p2' }) },
        { type: 'proposal.upserted', card: card({ id: 'p1', status: 'superseded' }) },
      ],
    });

    expect(Object.keys(state.cards)).toEqual(['p1', 'p2']);
    expect(state.cards.p1!.status).toBe('superseded');
  });

  it('sums the usage of every step', () => {
    const state = apply({
      events: [
        { type: 'usage', inputTokens: 10, outputTokens: 2, cachedInputTokens: 1 },
        { type: 'usage', inputTokens: 5, outputTokens: 3, cachedInputTokens: 0 },
      ],
    });

    expect(state.usage).toEqual({ inputTokens: 15, outputTokens: 5, cachedInputTokens: 1 });
  });

  it('records how the run finished, with its error', () => {
    const error = { code: 'timeout', messageKey: 'chat.errors.timeout' };
    const state = apply({ events: [{ type: 'run.finished', status: 'failed', error }] });

    expect(state).toMatchObject({ status: 'failed', error });
  });

  it('does not change the state it was given', () => {
    const before = apply({ events: [{ type: 'part.started', part: { type: 'text', id: 'a', text: 'x' } }] });
    const snapshot = structuredClone(before);

    applyRunEvent({ state: before, event: { type: 'text.delta', partId: 'a', delta: 'y' } });
    applyRunEvent({ state: before, event: { type: 'text.retracted', partIds: ['a'] } });

    expect(before).toEqual(snapshot);
  });
});
