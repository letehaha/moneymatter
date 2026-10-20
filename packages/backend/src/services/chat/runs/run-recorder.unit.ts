import type { ChatRunEvent } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { createRunRecorder } from './run-recorder';

const record = ({ events }: { events: ChatRunEvent[] }) => {
  const recorder = createRunRecorder();
  for (const event of events) recorder.apply(event);
  return recorder;
};

describe('createRunRecorder', () => {
  it('builds a text part from its start and deltas, in order', () => {
    const recorder = record({
      events: [
        { type: 'part.started', part: { type: 'text', id: 't1', text: '' } },
        { type: 'text.delta', partId: 't1', delta: 'Hello' },
        { type: 'text.delta', partId: 't1', delta: ', world' },
      ],
    });

    expect(recorder.parts()).toEqual([{ type: 'text', id: 't1', text: 'Hello, world' }]);
    expect(recorder.plainText()).toBe('Hello, world');
  });

  it('keeps the parts of different kinds in the order they started', () => {
    const recorder = record({
      events: [
        { type: 'part.started', part: { type: 'text', id: 't1', text: '' } },
        { type: 'text.delta', partId: 't1', delta: 'See the chart' },
        { type: 'part.started', part: { type: 'proposal', id: 'p1', proposalId: 'card-1' } },
        { type: 'part.started', part: { type: 'notice', id: 'n1', key: 'chat.notices.cancelled', params: {} } },
      ],
    });

    expect(recorder.parts().map((part) => part.type)).toEqual(['text', 'proposal', 'notice']);
  });

  it('drops the text parts a retraction names and keeps the rest', () => {
    const recorder = record({
      events: [
        { type: 'part.started', part: { type: 'text', id: 't1', text: '' } },
        { type: 'text.delta', partId: 't1', delta: 'Let me check' },
        { type: 'part.started', part: { type: 'text', id: 't2', text: '' } },
        { type: 'text.delta', partId: 't2', delta: 'one more thing' },
        { type: 'text.retracted', partIds: ['t1', 't2'] },
        { type: 'part.started', part: { type: 'proposal', id: 'p1', proposalId: 'card-1' } },
      ],
    });

    expect(recorder.parts()).toEqual([{ type: 'proposal', id: 'p1', proposalId: 'card-1' }]);
    expect(recorder.plainText()).toBeNull();
  });

  it('applies a patch to the part it names', () => {
    const recorder = record({
      events: [
        {
          type: 'part.started',
          part: { type: 'toolCall', id: 'c1', callId: 'call-1', toolName: 'get_accounts', args: {}, status: 'running' },
        },
        { type: 'part.updated', partId: 'c1', patch: { status: 'ok', durationMs: 12 } },
      ],
    });

    expect(recorder.parts()).toEqual([
      {
        type: 'toolCall',
        id: 'c1',
        callId: 'call-1',
        toolName: 'get_accounts',
        args: {},
        status: 'ok',
        durationMs: 12,
      },
    ]);
  });

  it('sums usage over steps', () => {
    const recorder = record({
      events: [
        { type: 'usage', inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 },
        { type: 'usage', inputTokens: 150, outputTokens: 30, cachedInputTokens: 0 },
      ],
    });

    expect(recorder.usage()).toEqual({ inputTokens: 250, outputTokens: 50, cachedInputTokens: 40 });
  });

  it('ignores a delta for a part it never saw and events that carry no part', () => {
    const recorder = record({
      events: [
        { type: 'run.started', runId: 'r', messageId: 'm', provider: 'custom', modelId: 'custom/x' },
        { type: 'text.delta', partId: 'ghost', delta: 'lost' },
        { type: 'run.finished', status: 'complete' },
      ],
    });

    expect(recorder.parts()).toEqual([]);
    expect(recorder.plainText()).toBeNull();
  });

  it('hands out copies, so a snapshot taken mid-run does not change as the run goes on', () => {
    const recorder = record({
      events: [
        { type: 'part.started', part: { type: 'text', id: 't1', text: '' } },
        { type: 'text.delta', partId: 't1', delta: 'Hel' },
      ],
    });
    const snapshot = recorder.parts();

    recorder.apply({ type: 'text.delta', partId: 't1', delta: 'lo' });

    expect(snapshot).toEqual([{ type: 'text', id: 't1', text: 'Hel' }]);
  });
});
