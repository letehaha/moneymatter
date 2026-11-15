import { describe, expect, it } from '@jest/globals';

import { compareStreamIds, encodeSseEvent, normalizeLastEventId, parseStreamEntry } from './event-log';

describe('encodeSseEvent', () => {
  it('writes the stream id as the SSE id, the type as the event name and the rest as the data', () => {
    const frame = encodeSseEvent({
      id: '1700000000000-3',
      event: { type: 'text.delta', partId: 'part-1', delta: 'Hello' },
    });

    expect(frame).toBe('id: 1700000000000-3\nevent: text.delta\ndata: {"partId":"part-1","delta":"Hello"}\n\n');
  });

  it('leaves the id line out for a synthetic event that has no place in the stream', () => {
    const frame = encodeSseEvent({ event: { type: 'run.finished', status: 'cancelled' } });

    expect(frame).toBe('event: run.finished\ndata: {"status":"cancelled"}\n\n');
  });

  it('keeps a delta that holds newlines on one data line, so a frame never ends early', () => {
    const frame = encodeSseEvent({ id: '1-0', event: { type: 'text.delta', partId: 'p', delta: 'a\n\nb' } });

    expect(frame.split('\n\n')).toHaveLength(2);
    expect(frame).toContain('"delta":"a\\n\\nb"');
  });
});

describe('parseStreamEntry', () => {
  it('reads the event back from the stored field', () => {
    const event = { type: 'usage', inputTokens: 5, outputTokens: 2, cachedInputTokens: 0 } as const;

    const entry = parseStreamEntry({ id: '1-1', fields: ['event', JSON.stringify(event)] });

    expect(entry).toEqual({ id: '1-1', event });
  });

  it('skips an entry whose payload is not an event', () => {
    expect(parseStreamEntry({ id: '1-1', fields: ['event', '{not json'] })).toBeNull();
    expect(parseStreamEntry({ id: '1-2', fields: ['event', '{"noType":true}'] })).toBeNull();
    expect(parseStreamEntry({ id: '1-3', fields: ['other', '{}'] })).toBeNull();
  });
});

describe('normalizeLastEventId', () => {
  it('passes a stream id through', () => {
    expect(normalizeLastEventId({ value: '1700000000000-12' })).toBe('1700000000000-12');
  });

  it.each([undefined, '', 'garbage', '12', '1-2-3', '1-0\r\nInjected: header', '-1-0'])(
    'starts from the beginning for %j',
    (value) => {
      expect(normalizeLastEventId({ value })).toBe('0-0');
    },
  );
});

describe('compareStreamIds', () => {
  it('compares the time part as a number, not as text', () => {
    expect(compareStreamIds({ a: '9-0', b: '10-0' })).toBeLessThan(0);
    expect(compareStreamIds({ a: '10-0', b: '9-0' })).toBeGreaterThan(0);
  });

  it('breaks a tie on the sequence part', () => {
    expect(compareStreamIds({ a: '10-2', b: '10-11' })).toBeLessThan(0);
    expect(compareStreamIds({ a: '10-11', b: '10-2' })).toBeGreaterThan(0);
  });

  it('treats equal ids as equal', () => {
    expect(compareStreamIds({ a: '1700000000000-4', b: '1700000000000-4' })).toBe(0);
  });

  it('holds for ids beyond the safe integer range', () => {
    expect(compareStreamIds({ a: '9007199254740993-0', b: '9007199254740992-0' })).toBeGreaterThan(0);
  });
});
