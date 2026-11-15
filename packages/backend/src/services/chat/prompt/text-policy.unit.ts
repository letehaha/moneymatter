import type { ChatRunEvent } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { createTextPolicy } from './text-policy';

const setup = () => {
  const events: ChatRunEvent[] = [];
  const policy = createTextPolicy({ emit: (event) => void events.push(event) });
  return { events, policy };
};

describe('createTextPolicy', () => {
  it('starts a text part on its first delta and passes every delta through', async () => {
    const { events, policy } = setup();

    await policy.delta({ partId: 't1', delta: 'Hel' });
    await policy.delta({ partId: 't1', delta: 'lo' });

    expect(events).toEqual([
      { type: 'part.started', part: { type: 'text', id: 't1', text: '' } },
      { type: 'text.delta', partId: 't1', delta: 'Hel' },
      { type: 'text.delta', partId: 't1', delta: 'lo' },
    ]);
  });

  it('retracts every earlier text part on the first card, once, and drops later text', async () => {
    const { events, policy } = setup();
    await policy.delta({ partId: 't1', delta: 'Let me check' });
    await policy.delta({ partId: 't2', delta: 'Done' });
    events.length = 0;

    await policy.cardCreated();
    await policy.cardCreated();
    await policy.delta({ partId: 't3', delta: 'Here is what I found' });

    expect(events).toEqual([{ type: 'text.retracted', partIds: ['t1', 't2'] }]);
    expect(policy.hasCard()).toBe(true);
    expect(policy.persistedTextParts()).toEqual([]);
  });

  it('emits nothing when a card comes before any text', async () => {
    const { events, policy } = setup();

    await policy.cardCreated();

    expect(events).toEqual([]);
    expect(policy.hasCard()).toBe(true);
  });

  it('persists the accumulated text of a run without cards', async () => {
    const { policy } = setup();
    await policy.delta({ partId: 't1', delta: 'You spent ' });
    await policy.delta({ partId: 't1', delta: '120 USD.' });
    await policy.delta({ partId: 't2', delta: 'Anything else?' });

    expect(policy.hasCard()).toBe(false);
    expect(policy.persistedTextParts()).toEqual([
      { type: 'text', id: 't1', text: 'You spent 120 USD.' },
      { type: 'text', id: 't2', text: 'Anything else?' },
    ]);
  });

  it('awaits an asynchronous emit in order', async () => {
    const order: string[] = [];
    const policy = createTextPolicy({
      emit: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, event.type === 'part.started' ? 5 : 0));
        order.push(event.type);
      },
    });

    await policy.delta({ partId: 't1', delta: 'a' });

    expect(order).toEqual(['part.started', 'text.delta']);
  });
});
