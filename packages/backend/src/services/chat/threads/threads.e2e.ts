import { CHAT_THREAD_TITLE_MAX_CHARS, SSE_EVENT_TYPES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatMessages from '@models/chat-messages.model';
import ChatThreads from '@models/chat-threads.model';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import { sseManager } from '@services/common/sse';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import type { ErrorResponse } from '@tests/helpers/common';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

const DAY_MS = 24 * 60 * 60 * 1000;

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

/** Arranges a stored message the way a finished run leaves it, without a model run. */
async function seedMessage({
  threadId,
  plainText,
  role = 'user',
  createdAt,
}: {
  threadId: string;
  plainText: string;
  role?: 'user' | 'assistant';
  createdAt?: Date;
}) {
  const thread = await ChatThreads.findByPk(threadId);
  return ChatMessages.create({
    threadId,
    userId: thread!.userId,
    role,
    status: 'complete',
    parts: [{ type: 'text', id: randomUUID(), text: plainText }],
    plainText,
    ...(createdAt ? { createdAt } : {}),
  });
}

const setLastMessageAt = ({ threadId, lastMessageAt }: { threadId: string; lastMessageAt: Date }) =>
  ChatThreads.update({ lastMessageAt }, { where: { id: threadId } });

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

describe('Chat threads', () => {
  describe('Authentication', () => {
    it('answers 401 to every thread route without a session', async () => {
      const id = randomUUID();
      const calls = [
        request(app).get(`${API_PREFIX}/chat/threads`),
        request(app).post(`${API_PREFIX}/chat/threads`).send({}),
        request(app).get(`${API_PREFIX}/chat/threads/${id}`),
        request(app).patch(`${API_PREFIX}/chat/threads/${id}`).send({ pinned: true }),
        request(app).delete(`${API_PREFIX}/chat/threads/${id}`),
        request(app).put(`${API_PREFIX}/chat/settings`).send({ retentionDays: 7 }),
      ];

      for (const call of calls) {
        expect((await call).statusCode).toBe(ERROR_CODES.Unauthorized);
      }
    });
  });

  describe('GET /chat/threads', () => {
    it('lists nothing for a user without threads', async () => {
      const page = await helpers.listChatThreads({ raw: true });

      expect(page).toEqual({ threads: [], nextCursor: null });
    });

    it('lists pinned threads first, then by last message, newest first', async () => {
      const oldest = await helpers.createChatThread({ title: 'Oldest', raw: true });
      const newest = await helpers.createChatThread({ title: 'Newest', raw: true });
      const pinnedOld = await helpers.createChatThread({ title: 'Pinned old', raw: true });
      const now = Date.now();
      await setLastMessageAt({ threadId: oldest.id, lastMessageAt: new Date(now - 3 * DAY_MS) });
      await setLastMessageAt({ threadId: newest.id, lastMessageAt: new Date(now - DAY_MS) });
      await setLastMessageAt({ threadId: pinnedOld.id, lastMessageAt: new Date(now - 10 * DAY_MS) });
      await helpers.updateChatThread({ threadId: pinnedOld.id, payload: { pinned: true } });

      const page = await helpers.listChatThreads({ raw: true });

      expect(page.threads.map((thread) => thread.title)).toEqual(['Pinned old', 'Newest', 'Oldest']);
      expect(page.nextCursor).toBeNull();
    });

    it('pages with a cursor and keeps the order across pages', async () => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const thread = await helpers.createChatThread({ title: `Thread ${index}`, raw: true });
        await setLastMessageAt({ threadId: thread.id, lastMessageAt: new Date(Date.UTC(2026, 9, 1 + index)) });
        ids.push(thread.id);
      }
      await helpers.updateChatThread({ threadId: ids[0]!, payload: { pinned: true } });

      const first = await helpers.listChatThreads({ limit: 2, raw: true });
      expect(first.threads.map((thread) => thread.title)).toEqual(['Thread 0', 'Thread 4']);
      expect(first.nextCursor).toBe(first.threads[1]!.id);

      const second = await helpers.listChatThreads({ limit: 2, cursor: first.nextCursor!, raw: true });
      expect(second.threads.map((thread) => thread.title)).toEqual(['Thread 3', 'Thread 2']);

      const third = await helpers.listChatThreads({ limit: 2, cursor: second.nextCursor!, raw: true });
      expect(third.threads.map((thread) => thread.title)).toEqual(['Thread 1']);
      expect(third.nextCursor).toBeNull();
    });

    it('rejects a limit above the maximum and a cursor that is not an id', async () => {
      expect((await helpers.listChatThreads({ limit: 101 })).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.listChatThreads({ cursor: 'nope' })).statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('POST /chat/threads', () => {
    it('creates a thread with the given title and a default 30 day expiry', async () => {
      const response = await helpers.createChatThread({ title: '  Monthly review  ' });

      expect(response.statusCode).toBe(201);
      const thread = response.body.response;
      expect(thread).toMatchObject({
        title: 'Monthly review',
        titleSource: 'user',
        pinned: false,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      });
      expect(new Date(thread.expiresAt!).getTime()).toBe(new Date(thread.lastMessageAt).getTime() + 30 * DAY_MS);
    });

    it('creates an untitled thread whose title the first message will fill in', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      expect(thread.title).toBe('');
      expect(thread.titleSource).toBe('auto');
    });

    it('answers 422 to a blank title and to one over the limit', async () => {
      const blank = await helpers.createChatThread({ title: '   ' });
      const tooLong = await helpers.createChatThread({ title: 'x'.repeat(CHAT_THREAD_TITLE_MAX_CHARS + 1) });

      expect(blank.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(tooLong.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('Page context of a thread', () => {
    const FOREIGN_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';

    it('keeps the page a thread started on, names its entity, and shows it in the list and on the thread', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Main card' }),
        raw: true,
      });
      const created = await helpers.createChatThread({
        pageContext: { route: 'dashboard.account', entity: { kind: 'account', id: account.id } },
        raw: true,
      });

      expect(created.pageContext).toEqual({ route: 'dashboard.account', entity: { kind: 'account', id: account.id } });
      expect(created.pageContextNames).toEqual({ [`account:${account.id}`]: 'Main card' });

      const loaded = await helpers.getChatThread({ threadId: created.id, raw: true });
      expect(loaded.thread.pageContext).toEqual(created.pageContext);
      expect(loaded.thread.pageContextNames).toEqual(created.pageContextNames);

      const listed = await helpers.listChatThreads({ raw: true });
      expect(listed.threads.find((thread) => thread.id === created.id)).toMatchObject({
        pageContext: created.pageContext,
        pageContextNames: created.pageContextNames,
      });
    });

    it('starts a thread without a page when none is sent', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      expect(thread.pageContext).toBeNull();
      expect(thread.pageContextNames).toEqual({});
    });

    it('drops an entity the user does not own when it is stored', async () => {
      const thread = await helpers.createChatThread({
        pageContext: { route: 'dashboard.planned.tracker-details', entity: { kind: 'tracker', id: FOREIGN_ID } },
        raw: true,
      });

      expect(thread.pageContext).toEqual({ route: 'dashboard.planned.tracker-details' });
    });

    it('replaces the page, removes it with null, and leaves it alone when the request does not name it', async () => {
      const thread = await helpers.createChatThread({ pageContext: { route: 'dashboard.transactions' }, raw: true });

      const replaced = await helpers.updateChatThread({
        threadId: thread.id,
        payload: { pageContext: { route: 'dashboard.budget' } },
        raw: true,
      });
      expect(replaced.pageContext).toEqual({ route: 'dashboard.budget' });

      const renamed = await helpers.updateChatThread({ threadId: thread.id, payload: { title: 'Budget' }, raw: true });
      expect(renamed.pageContext).toEqual({ route: 'dashboard.budget' });

      const removed = await helpers.updateChatThread({
        threadId: thread.id,
        payload: { pageContext: null },
        raw: true,
      });
      expect(removed.pageContext).toBeNull();
    });

    it('shows no name for an entity that is gone', async () => {
      const account = await helpers.createAccount({ raw: true });
      const thread = await helpers.createChatThread({
        pageContext: { route: 'dashboard.account', entity: { kind: 'account', id: account.id } },
        raw: true,
      });
      await ChatThreads.update(
        { pageContext: { route: 'dashboard.account', entity: { kind: 'account', id: FOREIGN_ID } } },
        { where: { id: thread.id } },
      );

      const loaded = await helpers.getChatThread({ threadId: thread.id, raw: true });

      expect(loaded.thread.pageContext?.entity?.id).toBe(FOREIGN_ID);
      expect(loaded.thread.pageContextNames).toEqual({});
    });

    it('no longer takes a page context on a message', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      const response = await helpers.sendChatMessage({
        threadId: thread.id,
        payload: { text: 'Hello', pageContext: { route: 'dashboard.budget' } },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('GET /chat/threads/:id', () => {
    it('returns the thread with its latest messages, oldest first, and pages backwards', async () => {
      const thread = await helpers.createChatThread({ title: 'History', raw: true });
      const base = Date.UTC(2026, 9, 1, 10, 0, 0);
      const messages: ChatMessages[] = [];
      for (let index = 0; index < 5; index += 1) {
        messages.push(
          await seedMessage({
            threadId: thread.id,
            plainText: `message ${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            createdAt: new Date(base + index * 60_000),
          }),
        );
      }

      const latest = await helpers.getChatThread({ threadId: thread.id, limit: 2, raw: true });
      expect(latest.thread.id).toBe(thread.id);
      expect(latest.messages.map((message) => message.plainText)).toEqual(['message 3', 'message 4']);
      expect(latest.hasMore).toBe(true);
      expect(latest.messages[0]).toMatchObject({ threadId: thread.id, role: 'assistant', status: 'complete' });

      const older = await helpers.getChatThread({
        threadId: thread.id,
        limit: 2,
        before: latest.messages[0]!.id,
        raw: true,
      });
      expect(older.messages.map((message) => message.plainText)).toEqual(['message 1', 'message 2']);
      expect(older.hasMore).toBe(true);

      const oldest = await helpers.getChatThread({
        threadId: thread.id,
        limit: 2,
        before: older.messages[0]!.id,
        raw: true,
      });
      expect(oldest.messages.map((message) => message.plainText)).toEqual(['message 0']);
      expect(oldest.hasMore).toBe(false);
      expect(messages).toHaveLength(5);
    });

    it('returns an empty conversation for a new thread', async () => {
      const thread = await helpers.createChatThread({ title: 'Empty', raw: true });

      const page = await helpers.getChatThread({ threadId: thread.id, raw: true });

      expect(page.messages).toEqual([]);
      expect(page.hasMore).toBe(false);
    });

    it('answers 404 to an unknown thread and to a `before` message of another thread', async () => {
      const first = await helpers.createChatThread({ title: 'First', raw: true });
      const second = await helpers.createChatThread({ title: 'Second', raw: true });
      const foreignMessage = await seedMessage({ threadId: second.id, plainText: 'elsewhere' });

      expect((await helpers.getChatThread({ threadId: randomUUID() })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.getChatThread({ threadId: first.id, before: foreignMessage.id })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
    });
  });

  describe('PATCH /chat/threads/:id', () => {
    it('renames a thread and marks the title as the user’s own', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      const response = await helpers.updateChatThread({ threadId: thread.id, payload: { title: ' Groceries ' } });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toMatchObject({ id: thread.id, title: 'Groceries', titleSource: 'user' });
      const listed = await helpers.listChatThreads({ raw: true });
      expect(listed.threads[0]!.title).toBe('Groceries');
    });

    it('accepts a title of exactly the maximum length and refuses a longer or blank one', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      const atLimit = await helpers.updateChatThread({
        threadId: thread.id,
        payload: { title: 'y'.repeat(CHAT_THREAD_TITLE_MAX_CHARS) },
      });
      const over = await helpers.updateChatThread({
        threadId: thread.id,
        payload: { title: 'y'.repeat(CHAT_THREAD_TITLE_MAX_CHARS + 1) },
      });
      const blank = await helpers.updateChatThread({ threadId: thread.id, payload: { title: '  ' } });

      expect(atLimit.statusCode).toBe(200);
      expect(over.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(blank.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('pins a thread, which clears its expiry, and recomputes the expiry on unpin', async () => {
      const thread = await helpers.createChatThread({ title: 'Keep', raw: true });
      expect(thread.expiresAt).not.toBeNull();

      const pinned = await helpers.updateChatThread({ threadId: thread.id, payload: { pinned: true }, raw: true });
      expect(pinned.pinned).toBe(true);
      expect(pinned.expiresAt).toBeNull();

      const unpinned = await helpers.updateChatThread({ threadId: thread.id, payload: { pinned: false }, raw: true });
      expect(unpinned.pinned).toBe(false);
      expect(new Date(unpinned.expiresAt!).getTime()).toBe(new Date(unpinned.lastMessageAt).getTime() + 30 * DAY_MS);
    });

    it('answers 422 to a body that changes nothing', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      const response = await helpers.updateChatThread({ threadId: thread.id, payload: {} });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('DELETE /chat/threads/:id', () => {
    it('deletes a thread together with its messages', async () => {
      const thread = await helpers.createChatThread({ title: 'Temporary', raw: true });
      await seedMessage({ threadId: thread.id, plainText: 'bye' });

      const response = await helpers.deleteChatThread({ threadId: thread.id });

      expect(response.statusCode).toBe(200);
      expect((await helpers.getChatThread({ threadId: thread.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.listChatThreads({ raw: true })).threads).toEqual([]);
      expect(await ChatMessages.count({ where: { threadId: thread.id } })).toBe(0);
    });

    it('answers 404 the second time', async () => {
      const thread = await helpers.createChatThread({ raw: true });
      await helpers.deleteChatThread({ threadId: thread.id });

      const again = await helpers.deleteChatThread({ threadId: thread.id });

      expect(again.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Isolation', () => {
    it('answers 404 on every route for another user’s thread and keeps it out of their list', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.createChatThread({ title: 'Private', raw: true }),
      });
      const mine = await helpers.createChatThread({ title: 'Mine', raw: true });

      expect((await helpers.getChatThread({ threadId: foreign.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.updateChatThread({ threadId: foreign.id, payload: { title: 'Taken' } })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
      expect((await helpers.updateChatThread({ threadId: foreign.id, payload: { pinned: true } })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
      expect((await helpers.deleteChatThread({ threadId: foreign.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.listChatThreads({ raw: true })).threads.map((thread) => thread.id)).toEqual([mine.id]);
      expect((await helpers.listChatThreads({ cursor: foreign.id, raw: true })).threads).toEqual([]);

      const untouched = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.getChatThread({ threadId: foreign.id, raw: true }),
      });
      expect(untouched.thread).toMatchObject({ title: 'Private', pinned: false });
    });

    it('keeps a household member who shares accounts with the owner out of the owner’s threads, and the other way round', async () => {
      const account = await helpers.createAccount({ raw: true });
      expect(account.id).toBeTruthy();
      const thread = await helpers.createChatThread({ title: 'Owner only', raw: true });
      const upload = await helpers.uploadChatAttachment({
        threadId: thread.id,
        file: Buffer.from(PNG_1X1_BASE64, 'base64'),
      });
      const attachmentId = upload.attachment!.id;

      const owner = await helpers.findAppUserByEmail({ email: 'test1@test.local' });
      const member = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createHouseholdInvitation({
        ownerUserId: owner.id,
        inviteeEmail: member.email,
      });
      await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      const memberView = await helpers.asUser({
        cookies: member.cookies,
        fn: async () => ({
          list: await helpers.listChatThreads({ raw: true }),
          get: await helpers.getChatThread({ threadId: thread.id }),
          patch: await helpers.updateChatThread({ threadId: thread.id, payload: { title: 'Mine now' } }),
          remove: await helpers.deleteChatThread({ threadId: thread.id }),
          image: await helpers.getChatAttachmentImage({ attachmentId }),
          upload: await helpers.uploadChatAttachment({
            threadId: thread.id,
            file: Buffer.from(PNG_1X1_BASE64, 'base64'),
          }),
          send: await helpers.sendChatMessage({ threadId: thread.id, payload: { text: 'Intrude' } }),
        }),
      });
      expect(memberView.list.threads).toEqual([]);
      expect(memberView.get.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(memberView.patch.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(memberView.remove.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(memberView.image.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(memberView.upload.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(memberView.send.statusCode).toBe(ERROR_CODES.NotFoundError);

      const memberThread = await helpers.asUser({
        cookies: member.cookies,
        fn: () => helpers.createChatThread({ title: 'Member only', raw: true }),
      });
      const ownerList = await helpers.listChatThreads({ raw: true });
      expect(ownerList.threads.map((item) => item.id)).toEqual([thread.id]);
      expect((await helpers.getChatThread({ threadId: memberThread.id })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.title).toBe('Owner only');
    }, 30_000);
  });

  describe('Search', () => {
    it('finds threads by title, ignoring case, and treats LIKE wildcards literally', async () => {
      await helpers.createChatThread({ title: 'Coffee budget', raw: true });
      await helpers.createChatThread({ title: 'Trip to Rome', raw: true });
      await helpers.createChatThread({ title: '100% sure', raw: true });
      await helpers.createChatThread({ title: 'Кава та чай', raw: true });

      const byWord = await helpers.listChatThreads({ q: 'COFFEE', raw: true });
      expect(byWord.threads.map((thread) => thread.title)).toEqual(['Coffee budget']);

      const byPart = await helpers.listChatThreads({ q: 'rom', raw: true });
      expect(byPart.threads.map((thread) => thread.title)).toEqual(['Trip to Rome']);

      const percent = await helpers.listChatThreads({ q: '100%', raw: true });
      expect(percent.threads.map((thread) => thread.title)).toEqual(['100% sure']);

      const underscore = await helpers.listChatThreads({ q: 'Co_fee', raw: true });
      expect(underscore.threads).toEqual([]);

      const cyrillic = await helpers.listChatThreads({ q: 'кава', raw: true });
      expect(cyrillic.threads.map((thread) => thread.title)).toEqual(['Кава та чай']);
      expect(cyrillic.threads[0]!.snippet).toBeUndefined();
    });

    it('returns an empty list when nothing matches and treats a blank query as no search', async () => {
      await helpers.createChatThread({ title: 'Something', raw: true });

      expect((await helpers.listChatThreads({ q: 'nothing like it', raw: true })).threads).toEqual([]);
      expect((await helpers.listChatThreads({ q: '   ', raw: true })).threads).toHaveLength(1);
    });

    it('does not search other users’ threads', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({ cookies: other.cookies, fn: () => helpers.createChatThread({ title: 'Secret plan' }) });

      expect((await helpers.listChatThreads({ q: 'secret', raw: true })).threads).toEqual([]);
    });

    it('finds a thread by a word of its messages, by prefix, with a plain-text snippet', async () => {
      const coffee = await helpers.createChatThread({ title: 'Untitled one', raw: true });
      const ukrainian = await helpers.createChatThread({ title: 'Untitled two', raw: true });
      const unrelated = await helpers.createChatThread({ title: 'Untitled three', raw: true });
      await seedMessage({ threadId: coffee.id, plainText: 'How much did I spend on coffee in September?' });
      await seedMessage({ threadId: ukrainian.id, plainText: 'Скільки я витратив на каву у вересні' });
      await seedMessage({ threadId: unrelated.id, plainText: 'What is my net worth?' });

      const english = await helpers.listChatThreads({ q: 'coff sep', raw: true });
      expect(english.threads.map((thread) => thread.id)).toEqual([coffee.id]);
      expect(english.threads[0]!.snippet).toContain('coffee');

      const cyrillic = await helpers.listChatThreads({ q: 'кав', raw: true });
      expect(cyrillic.threads.map((thread) => thread.id)).toEqual([ukrainian.id]);
      expect(cyrillic.threads[0]!.snippet).toContain('каву');

      const none = await helpers.listChatThreads({ q: 'espresso', raw: true });
      expect(none.threads).toEqual([]);
    });

    it('finds a thread by a word of an answer the model gave, by prefix, in English and in Ukrainian', async () => {
      await helpers.createFirstConnection();
      global.mswMockServer.use(
        createChatScript({ turns: [{ text: 'About forty euros.' }, { text: 'Близько сорока євро.' }] }).handler,
      );
      const english = await helpers.createChatThread({ raw: true });
      const ukrainian = await helpers.createChatThread({ raw: true });
      for (const [threadId, text] of [
        [english.id, 'How much did I spend on coffee?'],
        [ukrainian.id, 'Скільки я витратив на каву?'],
      ] as const) {
        const { runId } = await helpers.sendChatMessage({ threadId, payload: { text }, raw: true });
        await helpers.getChatRunEvents({ runId });
      }

      // Neither word is in a title: the hits come from the text of the answers.
      const byEnglish = await helpers.listChatThreads({ q: 'fort', raw: true });
      expect(byEnglish.threads.map((thread) => thread.id)).toEqual([english.id]);
      expect(byEnglish.threads[0]!.snippet).toContain('forty');

      const byUkrainian = await helpers.listChatThreads({ q: 'сорок', raw: true });
      expect(byUkrainian.threads.map((thread) => thread.id)).toEqual([ukrainian.id]);
      expect(byUkrainian.threads[0]!.snippet).toContain('сорока');
    });

    it('survives characters that are operators in a text-search query', async () => {
      const thread = await helpers.createChatThread({ title: 'Operators', raw: true });
      await seedMessage({ threadId: thread.id, plainText: 'spend & save (a lot) | more' });

      const response = await helpers.listChatThreads({ q: "spend & ( ! | '; --", raw: false });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.threads.map((item) => item.id)).toEqual([thread.id]);
    });
  });

  describe('Live updates', () => {
    it('tells the user’s other tabs about a thread that was created, renamed, pinned or deleted', async () => {
      const sseSpy = jest.spyOn(sseManager, 'sendToUser');
      try {
        const thread = await helpers.createChatThread({ title: 'Live', raw: true });
        await helpers.updateChatThread({ threadId: thread.id, payload: { title: 'Live renamed' } });
        await helpers.updateChatThread({ threadId: thread.id, payload: { pinned: true } });
        await helpers.deleteChatThread({ threadId: thread.id });

        const updates = sseSpy.mock.calls.filter(([arg]) => arg.event === SSE_EVENT_TYPES.CHAT_THREAD_UPDATED);
        expect(updates).toHaveLength(4);
        for (const [arg] of updates) expect(arg.data).toEqual({ threadId: thread.id });
      } finally {
        sseSpy.mockRestore();
      }
    });

    it('stays quiet when a request fails', async () => {
      const sseSpy = jest.spyOn(sseManager, 'sendToUser');
      try {
        await helpers.updateChatThread({ threadId: randomUUID(), payload: { pinned: true } });
        await helpers.deleteChatThread({ threadId: randomUUID() });

        expect(sseSpy.mock.calls.filter(([arg]) => arg.event === SSE_EVENT_TYPES.CHAT_THREAD_UPDATED)).toHaveLength(0);
      } finally {
        sseSpy.mockRestore();
      }
    });
  });

  it('answers 404 with the thread-not-found message', async () => {
    const response = await helpers.getChatThread({ threadId: randomUUID() });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(errorOf(response).message).toBe('Chat thread not found');
  });
});
