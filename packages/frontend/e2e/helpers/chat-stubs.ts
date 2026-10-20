import type { Page, Route } from '@playwright/test';

/**
 * A stand-in for the chat API, served from the page with `page.route`. The chat specs exercise the
 * frontend only: the model is not involved, so every run is a script of events the stub plays back
 * as one whole SSE body. Types are kept loose and inline because the e2e tsconfig has no path
 * mapping for the shared types.
 */

type Json = Record<string, unknown>;

export interface StubThread {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: string;
  /** The connection the thread runs on; null is the included model. */
  connectionId: string | null;
  /** A model of that connection picked for the thread; null is the connection's own model. */
  modelId: string | null;
  /** The page the conversation is about, as the API stores it; null is none. */
  pageContext: Json | null;
  messages: Json[];
}

export interface RunScript {
  events: Json[];
  /** The assistant message the thread holds once the run has finished. */
  finalParts: Json[];
}

export interface ChatStub {
  threads: StubThread[];
  cards: Map<string, Json>;
  appliedChanges: Json[];
  retentionDays: number | null;
  /** The user's AI connections, as the settings API lists them; null leaves the real list in place. */
  connections: Json[] | null;
  /** The model ids the providers list for a connection; null leaves the real listing in place. */
  connectionModels: string[] | null;
  /** What a new conversation starts on. */
  defaultConnectionId: string | null;
  /** The model a new conversation inherits along with the connection; null is the connection's own. */
  defaultModelId: string | null;
  /** The script the next message (or comment) starts. */
  nextRun: RunScript;
  /** Every request the page made to the chat API, in order. */
  calls: Array<{ method: string; path: string; body: unknown }>;
  addThread: (thread: Partial<StubThread> & { id: string }) => StubThread;
  addCard: (card: Json) => Json;
}

const NOW = '2026-03-05T10:00:00.000Z';
const DEFAULT_TITLE = 'New conversation';

const ok = ({ route, response, status = 200 }: { route: Route; response: unknown; status?: number }) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ status: 'success', response }) });

const notFound = ({ route }: { route: Route }) =>
  route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'error', response: { code: 'NotFoundError', message: 'Not found' } }),
  });

/** A 1x1 PNG, the bytes the stubbed image endpoint serves. */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

export const buildCard = (overrides: Json & { id: string }): Json & { id: string } => ({
  status: 'pending',
  revision: 1,
  toolName: 'create_tag',
  kind: 'create',
  entity: 'tag',
  danger: 'none',
  confirmation: { mode: 'none' },
  title: { key: 'chat.cards.title.create', params: { entity: 'tag' } },
  fields: [{ path: 'name', labelKey: 'chat.fields.name', value: 'Coffee', editable: null }],
  dependsOn: [],
  safe: true,
  warnings: [],
  sources: [],
  canApply: { ok: true },
  editedByUser: false,
  createdAt: NOW,
  expiresAt: '2026-03-06T10:00:00.000Z',
  ...overrides,
});

export const buildMessage = (overrides: Json & { id: string; role: 'user' | 'assistant' }): Json & { id: string } => ({
  threadId: 'thread-1',
  status: 'complete',
  parts: [],
  plainText: null,
  pageContext: null,
  runId: null,
  provider: null,
  modelId: null,
  promptVersion: null,
  usage: null,
  stepCount: 0,
  error: null,
  createdAt: NOW,
  ...overrides,
});

const sse = ({ events }: { events: Json[] }) =>
  events
    .map(({ type, ...data }, index) => `event: ${String(type)}\nid: ${index + 1}-0\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');

const asListItem = ({ thread, query }: { thread: StubThread; query: string }) => ({
  id: thread.id,
  title: thread.title,
  titleSource: 'user',
  pinned: thread.pinned,
  lastMessageAt: thread.lastMessageAt,
  expiresAt: null,
  usage: ZERO_USAGE,
  connectionId: thread.connectionId,
  modelId: thread.modelId,
  pageContext: thread.pageContext,
  pageContextNames: {},
  createdAt: NOW,
  ...(query ? { snippet: `…${thread.title}…` } : {}),
});

/**
 * Installs the stub and returns its state, which a test seeds before it opens a page and reads back
 * to see what the page sent. Anything outside `/api/v1/chat` goes to the real backend, apart from the
 * AI feature status (Chat is shown as running on a connection) and, when `retention` is stubbed, the
 * user settings (they carry the retention the stub holds).
 */
export async function stubChatApi({ page }: { page: Page }): Promise<ChatStub> {
  let counter = 0;
  const stub: ChatStub = {
    threads: [],
    cards: new Map(),
    appliedChanges: [],
    retentionDays: 30,
    connections: null,
    connectionModels: null,
    defaultConnectionId: null,
    defaultModelId: null,
    nextRun: { events: [{ type: 'run.finished', status: 'complete' }], finalParts: [] },
    calls: [],
    addThread: (thread) => {
      const created: StubThread = {
        title: DEFAULT_TITLE,
        pinned: false,
        lastMessageAt: NOW,
        connectionId: null,
        modelId: null,
        pageContext: null,
        messages: [],
        ...thread,
      };
      stub.threads.push(created);
      return created;
    },
    addCard: (card) => {
      stub.cards.set(String(card.id), card);
      return card;
    },
  };

  const runs = new Map<string, { thread: StubThread; messageId: string; script: RunScript }>();

  const findThread = ({ id }: { id: string }) => stub.threads.find((thread) => thread.id === id);
  const cardsOf = ({ messages }: { messages: Json[] }) =>
    Object.fromEntries(
      messages
        .flatMap((message) => (message.parts as Json[]).filter((part) => part.type === 'proposal'))
        .flatMap((part) => {
          const card = stub.cards.get(String(part.proposalId));
          return card ? [[String(part.proposalId), card] as const] : [];
        }),
    );

  const startRun = ({ thread, userText }: { thread: StubThread; userText: string }) => {
    counter += 1;
    const runId = `run-${counter}`;
    const userMessageId = `user-${counter}`;
    const messageId = `assistant-${counter}`;
    if (userText) {
      thread.messages.push(
        buildMessage({
          id: userMessageId,
          role: 'user',
          threadId: thread.id,
          parts: [{ type: 'text', id: `text-${counter}`, text: userText }],
        }),
      );
    }
    thread.messages.push(
      buildMessage({ id: messageId, role: 'assistant', threadId: thread.id, status: 'streaming', runId }),
    );
    if (thread.title === DEFAULT_TITLE && userText) thread.title = userText.slice(0, 40);
    runs.set(runId, { thread, messageId, script: stub.nextRun });
    return { runId, messageId, userMessageId };
  };

  /**
   * Fetches the real answer and rewrites it. A test can end while this request is still in flight, and
   * the closed page then rejects the fetch; that is not a failure of the test.
   */
  const rewriteRealResponse = async ({ route, rewrite }: { route: Route; rewrite: (body: Json) => void }) => {
    try {
      const response = await route.fetch();
      const body = await response.json();
      rewrite(body);
      await route.fulfill({ response, json: body });
    } catch (error) {
      if (page.isClosed() || /closed|disposed/i.test(String(error))) return;
      throw error;
    }
  };

  await page.route('**/api/v1/user/settings/ai/features', (route) =>
    rewriteRealResponse({
      route,
      rewrite: (body) => {
        const features = ((body.response as Json | undefined)?.features ?? []) as Json[];
        const chat = features.find((feature) => feature.feature === 'chat');
        if (chat) Object.assign(chat, { isConfigured: true, servedBy: 'connection', modelId: 'custom/test-model' });
      },
    }),
  );

  await page.route('**/api/v1/user/settings/ai/connections', (route) => {
    if (route.request().method() !== 'GET' || stub.connections === null) return route.fallback();
    return ok({ route, response: stub.connections });
  });

  await page.route('**/api/v1/user/settings/ai/connections/models', (route) => {
    if (route.request().method() !== 'POST' || stub.connectionModels === null) return route.fallback();
    return ok({ route, response: { models: stub.connectionModels } });
  });

  await page.route('**/api/v1/user/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return rewriteRealResponse({
      route,
      rewrite: (body) => {
        const response = (body.response ?? {}) as Json & { ai?: Json };
        body.response = { ...response, ai: { ...response.ai, chat: { retentionDays: stub.retentionDays } } };
      },
    });
  });

  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1\/chat/, '');
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData()!) as Json) : undefined;
    stub.calls.push({ method, path, body });

    if (method === 'GET' && path === '/threads') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const matching = stub.threads.filter((thread) => thread.title.toLowerCase().includes(query));
      const ordered = [...matching].sort((a, b) => Number(b.pinned) - Number(a.pinned));
      return ok({
        route,
        response: { threads: ordered.map((thread) => asListItem({ thread, query })), nextCursor: null },
      });
    }

    if (method === 'GET' && path === '/default-connection') {
      return ok({ route, response: { connectionId: stub.defaultConnectionId, modelId: stub.defaultModelId } });
    }

    if (method === 'POST' && path === '/threads') {
      const thread = stub.addThread({
        id: `thread-${stub.threads.length + 1}`,
        connectionId: 'connectionId' in (body ?? {}) ? (body!.connectionId as string | null) : stub.defaultConnectionId,
        modelId: 'modelId' in (body ?? {}) ? (body!.modelId as string | null) : stub.defaultModelId,
        pageContext: (body?.pageContext as Json | null | undefined) ?? null,
      });
      return ok({ route, response: asListItem({ thread, query: '' }), status: 201 });
    }

    const threadMatch = path.match(/^\/threads\/([^/]+)$/);
    if (threadMatch) {
      const thread = findThread({ id: threadMatch[1]! });
      if (!thread) return notFound({ route });

      if (method === 'GET') {
        return ok({
          route,
          response: {
            thread: asListItem({ thread, query: '' }),
            messages: thread.messages,
            hasMore: false,
            cards: cardsOf({ messages: thread.messages }),
          },
        });
      }
      if (method === 'PATCH') {
        if (typeof body?.title === 'string') thread.title = body.title;
        if (typeof body?.pinned === 'boolean') thread.pinned = body.pinned;
        if (body && 'connectionId' in body) {
          thread.connectionId = body.connectionId as string | null;
          thread.modelId = null;
        }
        if (body && 'modelId' in body) thread.modelId = body.modelId as string | null;
        if (body && 'pageContext' in body) thread.pageContext = body.pageContext as Json | null;
        return ok({ route, response: asListItem({ thread, query: '' }) });
      }
      if (method === 'DELETE') {
        stub.threads = stub.threads.filter((candidate) => candidate.id !== thread.id);
        return ok({ route, response: {} });
      }
    }

    const messagesMatch = path.match(/^\/threads\/([^/]+)\/messages$/);
    if (method === 'POST' && messagesMatch) {
      const thread = findThread({ id: messagesMatch[1]! });
      if (!thread) return notFound({ route });
      return ok({ route, response: startRun({ thread, userText: String(body?.text ?? '') }), status: 202 });
    }

    const eventsMatch = path.match(/^\/runs\/([^/]+)\/events$/);
    if (method === 'GET' && eventsMatch) {
      const run = runs.get(eventsMatch[1]!);
      if (!run) return notFound({ route });
      // The message is final once the stream has been served, which is what the page reads next.
      const message = run.thread.messages.find((candidate) => candidate.id === run.messageId);
      if (message) Object.assign(message, { status: 'complete', parts: run.script.finalParts });
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sse({ events: run.script.events }),
      });
    }

    const cardMatch = path.match(/^\/proposals\/([^/]+)\/(approve|reject|comment|refresh)$/);
    if (method === 'POST' && cardMatch) {
      const card = stub.cards.get(cardMatch[1]!);
      if (!card) return notFound({ route });
      const action = cardMatch[2];

      if (action === 'comment') {
        const thread = stub.threads.find((candidate) =>
          candidate.messages.some((message) =>
            (message.parts as Json[]).some((part) => part.type === 'proposal' && part.proposalId === card.id),
          ),
        );
        if (!thread) return notFound({ route });
        return ok({ route, response: startRun({ thread, userText: '' }), status: 202 });
      }

      const next =
        action === 'approve'
          ? { status: 'applied', result: { refs: [], executedArgs: {}, appliedAt: NOW } }
          : action === 'reject'
            ? { status: 'rejected' }
            : {};
      Object.assign(card, next, { revision: Number(card.revision) + 1 });
      return ok({ route, response: { card, cards: [card] } });
    }

    const approveAllMatch = path.match(/^\/messages\/([^/]+)\/approve-all$/);
    if (method === 'POST' && approveAllMatch) {
      const revisions = (body?.revisions ?? {}) as Record<string, number>;
      const results = Object.keys(revisions).map((proposalId) => {
        const card = stub.cards.get(proposalId);
        if (!card?.safe) return { proposalId, outcome: 'skipped', reasonKey: 'chat.cards.needsConfirmation' };
        Object.assign(card, {
          status: 'applied',
          revision: Number(card.revision) + 1,
          result: { refs: [], executedArgs: {}, appliedAt: NOW },
        });
        return { proposalId, outcome: 'applied' };
      });
      return ok({ route, response: { results, cards: Object.keys(revisions).map((id) => stub.cards.get(id)) } });
    }

    if (method === 'PUT' && path === '/settings') {
      stub.retentionDays = (body?.retentionDays ?? null) as number | null;
      return ok({ route, response: { retentionDays: stub.retentionDays } });
    }

    const imageMatch = path.match(/^\/attachments\/([^/]+)\/image$/);
    if (method === 'GET' && imageMatch) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1X1_BASE64, 'base64') });
    }

    if (method === 'GET' && path === '/applied') {
      return ok({ route, response: { items: stub.appliedChanges, nextCursor: null } });
    }

    return notFound({ route });
  });

  return stub;
}

/** The events of a run that streams `text` in two deltas and finishes. */
export const textRun = ({ text }: { text: string }): RunScript => {
  const middle = Math.ceil(text.length / 2);
  return {
    events: [
      { type: 'run.started', runId: 'run', messageId: 'assistant', provider: 'custom', modelId: 'test-model' },
      { type: 'part.started', part: { type: 'text', id: 'part-text', text: '' } },
      { type: 'text.delta', partId: 'part-text', delta: text.slice(0, middle) },
      { type: 'text.delta', partId: 'part-text', delta: text.slice(middle) },
      { type: 'run.finished', status: 'complete' },
    ],
    finalParts: [{ type: 'text', id: 'part-text', text }],
  };
};
