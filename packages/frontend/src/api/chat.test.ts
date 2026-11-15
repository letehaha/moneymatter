import type { ChatRunEvent } from '@bt/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatThread, streamChatRunEvents } from './chat';

type Handlers = {
  onopen: (response: { ok: boolean; status: number }) => Promise<void>;
  onmessage: (message: { id?: string; event?: string; data?: string }) => void;
  onclose: () => void;
  onerror: (error: unknown) => void;
  headers: Record<string, string>;
  signal: AbortSignal;
};

const fetchEventSource = vi.fn();
const post = vi.fn();

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (...args: unknown[]) => fetchEventSource(...args),
}));
vi.mock('@/api/_api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));
vi.mock('@/api/_binary-download', () => ({ fetchBinaryDownload: vi.fn() }));
vi.mock('@/i18n', () => ({ getCurrentLocale: () => 'en' }));

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

const frame = ({ id, type, data = {} }: { id?: string; type: ChatRunEvent['type']; data?: object }): Frame => ({
  id,
  event: type,
  data: JSON.stringify(data),
});

/** What one connection does: opens, delivers `frames`, then either settles (abort or close) as `end` says. */
const connection = ({
  frames = [],
  open = { ok: true, status: 200 },
  end = 'drop',
}: {
  frames?: Frame[];
  open?: { ok: boolean; status: number };
  end?: 'drop' | 'hang';
} = {}) => {
  fetchEventSource.mockImplementationOnce(async (_url: string, handlers: Handlers) => {
    await handlers.onopen(open);
    for (const message of frames) {
      if (handlers.signal.aborted) return;
      handlers.onmessage(message);
    }
    if (handlers.signal.aborted) return;
    if (end === 'drop') {
      handlers.onclose();
      return;
    }
    await new Promise<void>((resolve) => handlers.signal.addEventListener('abort', () => resolve()));
  });
};

const run = (
  { signal = new AbortController().signal, ...rest } = {} as { signal?: AbortSignal; maxConsecutiveFailures?: number },
) => {
  const events: ChatRunEvent[] = [];
  const outcome = streamChatRunEvents({
    runId: 'run-1',
    signal,
    onEvent: (event) => events.push(event),
    retryDelayMs: 0,
    ...rest,
  });
  return { events, outcome };
};

beforeEach(() => {
  fetchEventSource.mockReset();
  post.mockReset();
});

describe('createChatThread', () => {
  it('sends the page the conversation starts on', async () => {
    const pageContext = { route: 'dashboard.account', entity: { kind: 'account' as const, id: 'acc-1' } };

    await createChatThread({ connectionId: 'conn-1', pageContext });

    expect(post).toHaveBeenCalledWith('/chat/threads', { connectionId: 'conn-1', pageContext });
  });

  it('sends an explicit null for no page', async () => {
    await createChatThread({ connectionId: null, pageContext: null });

    expect(post).toHaveBeenCalledWith('/chat/threads', { connectionId: null, pageContext: null });
  });
});

describe('streamChatRunEvents', () => {
  it('delivers each frame as an event with its type, in order, and stops on run.finished', async () => {
    connection({
      end: 'hang',
      frames: [
        frame({
          id: '1-0',
          type: 'run.started',
          data: { runId: 'run-1', messageId: 'm', provider: 'p', modelId: 'x' },
        }),
        frame({ id: '2-0', type: 'text.delta', data: { partId: 'a', delta: 'Hi' } }),
        frame({ id: '3-0', type: 'run.finished', data: { status: 'complete' } }),
        frame({ id: '4-0', type: 'text.delta', data: { partId: 'a', delta: 'ignored' } }),
      ],
    });

    const { events, outcome } = run();

    expect(await outcome).toBe('finished');
    expect(events).toEqual([
      { type: 'run.started', runId: 'run-1', messageId: 'm', provider: 'p', modelId: 'x' },
      { type: 'text.delta', partId: 'a', delta: 'Hi' },
      { type: 'run.finished', status: 'complete' },
    ]);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    expect(fetchEventSource.mock.calls[0]![0]).toContain('/chat/runs/run-1/events');
  });

  it('resumes after the last id it saw when the connection drops', async () => {
    connection({
      frames: [
        frame({ id: '1-0', type: 'part.started', data: { part: { type: 'text', id: 'a', text: '' } } }),
        frame({ id: '2-0', type: 'text.delta', data: { partId: 'a', delta: 'He' } }),
      ],
    });
    connection({
      end: 'hang',
      frames: [
        frame({ id: '3-0', type: 'text.delta', data: { partId: 'a', delta: 'llo' } }),
        frame({ id: '4-0', type: 'run.finished', data: { status: 'complete' } }),
      ],
    });

    const { events, outcome } = run();

    expect(await outcome).toBe('finished');
    expect(fetchEventSource).toHaveBeenCalledTimes(2);
    expect(fetchEventSource.mock.calls[0]![1].headers['Last-Event-ID']).toBeUndefined();
    expect(fetchEventSource.mock.calls[1]![1].headers['Last-Event-ID']).toBe('2-0');
    expect(events.map((event) => event.type)).toEqual(['part.started', 'text.delta', 'text.delta', 'run.finished']);
  });

  it('skips comments and frames it cannot read', async () => {
    connection({
      end: 'hang',
      frames: [
        { event: undefined, data: '' },
        { id: '1-0', event: 'text.delta', data: '{not json' },
        frame({ id: '2-0', type: 'run.finished', data: { status: 'failed' } }),
      ],
    });

    const { events, outcome } = run();

    expect(await outcome).toBe('finished');
    expect(events).toEqual([{ type: 'run.finished', status: 'failed' }]);
  });

  it('delivers the closing event of an expired stream, which has no id', async () => {
    connection({ end: 'hang', frames: [frame({ type: 'run.finished', data: { status: 'interrupted' } })] });

    const { events, outcome } = run();

    expect(await outcome).toBe('finished');
    expect(events).toEqual([{ type: 'run.finished', status: 'interrupted' }]);
  });

  it('gives up without retrying when the server refuses the stream', async () => {
    connection({ open: { ok: false, status: 404 } });

    const { outcome } = run();

    expect(await outcome).toBe('failed');
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many drops in a row', async () => {
    for (let index = 0; index < 4; index += 1) connection();

    const { outcome } = run({ maxConsecutiveFailures: 2 });

    expect(await outcome).toBe('failed');
    expect(fetchEventSource).toHaveBeenCalledTimes(3);
  });

  it('counts only consecutive drops: a connection that opened starts the count again', async () => {
    for (let index = 0; index < 4; index += 1)
      connection({
        frames: [
          frame({
            id: `${index + 1}-0`,
            type: 'usage',
            data: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
          }),
        ],
      });
    connection({ end: 'hang', frames: [frame({ id: '9-0', type: 'run.finished', data: { status: 'complete' } })] });

    const { outcome } = run({ maxConsecutiveFailures: 1 });

    expect(await outcome).toBe('finished');
    expect(fetchEventSource).toHaveBeenCalledTimes(5);
  });

  it('ends as aborted when the caller aborts', async () => {
    const controller = new AbortController();
    connection({ end: 'hang' });

    const { outcome } = run({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    expect(await outcome).toBe('aborted');
  });

  it('does not connect when it is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const { outcome } = run({ signal: controller.signal });

    expect(await outcome).toBe('aborted');
    expect(fetchEventSource).not.toHaveBeenCalled();
  });
});
