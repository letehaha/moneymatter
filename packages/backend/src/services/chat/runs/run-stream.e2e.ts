import { CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_MAX_RUNS_PER_USER, CHAT_MESSAGE_MAX_CHARS } from '@bt/shared/types';
import { until } from '@common/helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatAttachments from '@models/chat-attachments.model';
import ChatMessages from '@models/chat-messages.model';
import { redisClient } from '@root/redis-client';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { provisionDemoUser } from '@tests/helpers/chat-cards';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import type { ChatScriptTurn } from '@tests/mocks/openai-compatible/chat-script';

import { runStreamKey } from './event-log';
import { userRunsKey } from './run-lease';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

/** A model connection plus a scripted model; the connection answers through msw. */
async function arrange({ turns }: { turns: ChatScriptTurn[] }) {
  await helpers.createFirstConnection();
  const script = createChatScript({ turns });
  global.mswMockServer.use(script.handler);
  return { script, threadId: (await helpers.createChatThread({ raw: true })).id };
}

const HOLD: ChatScriptTurn = { text: ['Working', ' on it', ' still'], pieceDelayMs: 8_000 };

/** Gives the run time to reach the model before a test reacts to it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

async function sendAndFinish({ threadId, text }: { threadId: string; text: string }) {
  const sent = await helpers.sendChatMessage({ threadId, payload: { text }, raw: true });
  await helpers.getChatRunEvents({ runId: sent.runId });
  return sent;
}

describe('Chat runs', () => {
  describe('POST /chat/threads/:id/messages and GET /chat/runs/:runId/events', () => {
    it('answers 202 with the run, streams the answer and stores the finished message', async () => {
      const { script, threadId } = await arrange({
        turns: [
          { text: ['Hello', ', ', 'world'], usage: { promptTokens: 120, completionTokens: 8, cachedTokens: 20 } },
        ],
      });

      const sent = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Where did my money go in September?' },
      });
      expect(sent.statusCode).toBe(202);
      const { runId, messageId, userMessageId } = sent.body.response;

      const stream = await helpers.getChatRunEvents({ runId });
      expect(stream.statusCode).toBe(200);
      expect(stream.contentType).toContain('text/event-stream');

      const types = stream.events.map((event) => event.type);
      expect(types[0]).toBe('run.started');
      expect(types.at(-1)).toBe('run.finished');
      expect(types).toContain('text.delta');
      expect(stream.events[0]).toMatchObject({ type: 'run.started', runId, messageId, provider: 'custom' });
      expect(stream.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
      expect(helpers.streamedChatText({ events: stream.events })).toBe('Hello, world');
      expect(stream.events).toContainEqual(
        expect.objectContaining({ type: 'usage', inputTokens: 120, outputTokens: 8, cachedInputTokens: 20 }),
      );
      expect(stream.events.every((event) => event.streamId !== null)).toBe(true);

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(loaded.messages[0]).toMatchObject({
        id: userMessageId,
        status: 'complete',
        plainText: 'Where did my money go in September?',
      });
      expect(loaded.messages[0]!.parts).toEqual([
        { type: 'text', id: expect.any(String), text: 'Where did my money go in September?' },
      ]);
      expect(loaded.messages[1]).toMatchObject({
        id: messageId,
        runId,
        status: 'complete',
        plainText: 'Hello, world',
        provider: 'custom',
        modelId: 'custom/llama3.2',
        stepCount: 1,
        usage: { inputTokens: 120, outputTokens: 8, cachedInputTokens: 20 },
        error: null,
      });
      expect(loaded.messages[1]!.parts).toEqual([{ type: 'text', id: expect.any(String), text: 'Hello, world' }]);
      expect(loaded.thread).toMatchObject({
        title: 'Where did my money go in September?',
        titleSource: 'auto',
        usage: { inputTokens: 120, outputTokens: 8, cachedInputTokens: 20 },
      });
      expect(loaded.thread.expiresAt).not.toBeNull();

      expect(script.requests).toHaveLength(1);
      expect(script.requests[0]!.stream).toBe(true);
      expect(script.requests[0]!.messages!.at(-1)).toMatchObject({
        role: 'user',
        content: 'Where did my money go in September?',
      });
    });

    it('sums usage per thread over several runs and keeps the first message as the title', async () => {
      const { threadId } = await arrange({
        turns: [
          { text: 'First answer', usage: { promptTokens: 10, completionTokens: 2 } },
          { text: 'Second answer', usage: { promptTokens: 30, completionTokens: 4, cachedTokens: 5 } },
        ],
      });

      await sendAndFinish({ threadId, text: 'First question' });
      await sendAndFinish({ threadId, text: 'Second question' });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.messages).toHaveLength(4);
      expect(loaded.thread.title).toBe('First question');
      expect(loaded.thread.usage).toEqual({ inputTokens: 40, outputTokens: 6, cachedInputTokens: 5 });
    });

    it('carries the earlier turns to the model on the next message', async () => {
      const { script, threadId } = await arrange({ turns: [{ text: 'It is blue.' }, { text: 'Yes.' }] });

      await sendAndFinish({ threadId, text: 'What colour is the sky?' });
      await sendAndFinish({ threadId, text: 'Are you sure?' });

      const roles = script.requests[1]!.messages!.map((message) => message.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
      expect(script.requests[1]!.messages![2]).toMatchObject({ role: 'assistant', content: 'It is blue.' });
    });

    it('resumes after the id in Last-Event-ID and delivers only the later events', async () => {
      const { threadId } = await arrange({ turns: [{ text: ['one ', 'two ', 'three ', 'four'] }] });
      const { runId } = await helpers.sendChatMessage({ threadId, payload: { text: 'Count' }, raw: true });

      const full = await helpers.getChatRunEvents({ runId });
      const resumeFrom = full.events[2]!.streamId!;
      const resumed = await helpers.getChatRunEvents({ runId, lastEventId: resumeFrom });

      expect(resumed.events.map((event) => event.streamId)).toEqual(
        full.events.slice(3).map((event) => event.streamId),
      );
      expect(resumed.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
    });

    it('replays a run that finished long ago from the stored message once its stream has expired', async () => {
      const { threadId } = await arrange({ turns: [{ text: 'Done already' }] });
      const { runId } = await sendAndFinish({ threadId, text: 'Quick one' });
      await redisClient.del(runStreamKey({ runId }));

      const replay = await helpers.getChatRunEvents({ runId });

      expect(replay.statusCode).toBe(200);
      expect(replay.events).toEqual([{ type: 'run.finished', status: 'complete', streamId: null }]);
    });

    it('cancels a run in progress and stores what it had written', async () => {
      const { script, threadId } = await arrange({ turns: [HOLD] });
      const { runId, messageId } = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Slow one' },
        raw: true,
      });
      await settle();

      const cancelled = await helpers.cancelChatRun({ runId });
      expect(cancelled.statusCode).toBe(200);

      const stream = await helpers.getChatRunEvents({ runId });
      expect(stream.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'cancelled' });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      const assistant = loaded.messages.find((message) => message.id === messageId)!;
      expect(assistant.status).toBe('cancelled');
      expect(assistant.parts).toContainEqual(
        expect.objectContaining({ type: 'notice', key: 'chat.notices.cancelled' }),
      );
      expect(script.requests).toHaveLength(1);

      const again = await helpers.cancelChatRun({ runId });
      expect(again.statusCode).toBe(200);
      expect(again.body.response.status).toBe('cancelled');
    });

    it('answers 409 to a second message while the thread has a run, and accepts one after it ends', async () => {
      const { threadId } = await arrange({ turns: [HOLD, { text: 'Next answer' }] });
      const first = await helpers.sendChatMessage({ threadId, payload: { text: 'First' }, raw: true });
      await settle();

      const second = await helpers.sendChatMessage({ threadId, payload: { text: 'Second' } });
      expect(second.statusCode).toBe(ERROR_CODES.ConflictError);

      await helpers.cancelChatRun({ runId: first.runId });
      await helpers.getChatRunEvents({ runId: first.runId });

      const third = await helpers.sendChatMessage({ threadId, payload: { text: 'Third' } });
      expect(third.statusCode).toBe(202);
      await helpers.getChatRunEvents({ runId: third.body.response.runId });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      // The refused message left nothing behind.
      expect(loaded.messages.filter((message) => message.role === 'user').map((message) => message.plainText)).toEqual([
        'First',
        'Third',
      ]);
    });

    it(`answers 429 to a run past ${CHAT_MAX_RUNS_PER_USER} at once for the user`, async () => {
      const { threadId: firstThread } = await arrange({ turns: [HOLD, HOLD, HOLD, { text: 'Fourth answer' }] });
      const otherThreads = [
        (await helpers.createChatThread({ raw: true })).id,
        (await helpers.createChatThread({ raw: true })).id,
        (await helpers.createChatThread({ raw: true })).id,
      ];
      const running: Array<{ runId: string }> = [];
      for (const threadId of [firstThread, otherThreads[0]!, otherThreads[1]!]) {
        running.push(await helpers.sendChatMessage({ threadId, payload: { text: 'Hold' }, raw: true }));
      }
      await settle();

      const refused = await helpers.sendChatMessage({ threadId: otherThreads[2]!, payload: { text: 'One too many' } });
      expect(refused.statusCode).toBe(ERROR_CODES.TooManyRequests);

      for (const { runId } of running) {
        await helpers.cancelChatRun({ runId });
        await helpers.getChatRunEvents({ runId });
      }
      const accepted = await helpers.sendChatMessage({ threadId: otherThreads[2]!, payload: { text: 'Now it fits' } });
      expect(accepted.statusCode).toBe(202);
      await helpers.getChatRunEvents({ runId: accepted.body.response.runId });
    });

    it('answers 429 to the 31st message in ten minutes', async () => {
      const { threadId } = await arrange({ turns: Array.from({ length: 30 }, () => ({ text: 'ok' })) });

      for (let index = 0; index < 30; index++) {
        const sent = await helpers.sendChatMessage({ threadId, payload: { text: `Message ${index}` } });
        expect(sent.statusCode).toBe(202);
        await helpers.getChatRunEvents({ runId: sent.body.response.runId });
      }
      const rejected = await helpers.sendChatMessage({ threadId, payload: { text: 'One more' } });

      expect(rejected.statusCode).toBe(ERROR_CODES.TooManyRequests);
    }, 120_000);

    it('answers 422 to a message over the length limit and to an empty one', async () => {
      const { threadId } = await arrange({ turns: [] });

      const tooLong = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'a'.repeat(CHAT_MESSAGE_MAX_CHARS + 1) },
      });
      const empty = await helpers.sendChatMessage({ threadId, payload: { text: '   ' } });

      expect(tooLong.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(empty.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('answers 403 to a demo user', async () => {
      const { threadId } = await arrange({ turns: [] });
      const demo = await provisionDemoUser();

      // The guard answers before the thread is looked up, so the demo user needs no thread of their own.
      const sent = await helpers.asUser({
        cookies: demo.cookies,
        fn: () => helpers.sendChatMessage({ threadId, payload: { text: 'Hello' } }),
      });

      expect(sent.statusCode).toBe(ERROR_CODES.Forbidden);
    }, 60_000);

    it('answers 422 with the missing-configuration message when no model is configured', async () => {
      const threadId = (await helpers.createChatThread({ raw: true })).id;

      const sent = await helpers.sendChatMessage({ threadId, payload: { text: 'Hello' } });

      expect(sent.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(helpers.errorMessage({ response: sent })).toBe('No AI model configured. Add one in Settings → AI.');
      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.messages).toEqual([]);
    });

    it('ends a run whose model fails as failed, with a classified error', async () => {
      const { threadId } = await arrange({
        turns: [{ error: { status: 429, message: 'Rate limit reached for requests' } }],
      });
      const { runId, messageId } = await helpers.sendChatMessage({ threadId, payload: { text: 'Hello' }, raw: true });

      const stream = await helpers.getChatRunEvents({ runId });

      expect(stream.events.at(-1)).toMatchObject({
        type: 'run.finished',
        status: 'failed',
        error: { code: 'rateLimited', messageKey: 'chat.errors.rateLimited' },
      });
      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.messages.find((message) => message.id === messageId)).toMatchObject({
        status: 'failed',
        error: { code: 'rateLimited', messageKey: 'chat.errors.rateLimited' },
      });
    });

    it('answers 404 to another user’s thread, run events and cancel', async () => {
      const { threadId } = await arrange({ turns: [{ text: 'Private answer' }] });
      const { runId } = await sendAndFinish({ threadId, text: 'Private question' });
      const other = await helpers.provisionSecondUserWithBaseCurrency();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const send = await helpers.sendChatMessage({ threadId, payload: { text: 'Intrude' } });
          const events = await helpers.getChatRunEvents({ runId });
          const cancel = await helpers.cancelChatRun({ runId });

          expect(send.statusCode).toBe(ERROR_CODES.NotFoundError);
          expect(events.statusCode).toBe(ERROR_CODES.NotFoundError);
          expect(cancel.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });
    });

    it('answers 404 to an unknown run', async () => {
      const events = await helpers.getChatRunEvents({ runId: '00000000-0000-7000-8000-000000000000' });

      expect(events.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('answers 401 to the stream and cancel routes without a session', async () => {
      const runId = '00000000-0000-7000-8000-000000000000';

      const [events, cancel] = await helpers.withoutSession(async () => [
        await helpers.getChatRunEvents({ runId }),
        await helpers.cancelChatRun({ runId }),
      ]);

      expect(events.statusCode).toBe(ERROR_CODES.Unauthorized);
      expect(cancel.statusCode).toBe(ERROR_CODES.Unauthorized);
    });

    it('stops the run of a thread that is deleted while it runs and frees its slots', async () => {
      const { threadId } = await arrange({ turns: [HOLD] });
      const { runId } = await helpers.sendChatMessage({ threadId, payload: { text: 'Slow one' }, raw: true });
      await settle();
      const userId = await helpers.getTestUserId();
      expect(await redisClient.zcard(userRunsKey({ userId }))).toBe(1);

      await helpers.deleteChatThread({ threadId });

      await until(async () => (await redisClient.zcard(userRunsKey({ userId }))) === 0, {
        timeout: 5_000,
        interval: 50,
      });
      expect(await redisClient.zcard(userRunsKey({ userId }))).toBe(0);
      expect((await helpers.getChatRunEvents({ runId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Attachments on a message', () => {
    const csv = (name: string) => Buffer.from(`date,description,amount\n2026-10-01,${name},-3.50\n`);

    it('leaves a thread whose only message is a generic image untitled', async () => {
      const { threadId } = await arrange({ turns: [{ text: 'A receipt.' }] });
      const upload = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.from(PNG_1X1_BASE64, 'base64'),
        filename: 'image.png',
      });

      const sent = await helpers.sendChatMessage({
        threadId,
        payload: { text: '', attachmentIds: [upload.attachment!.id] },
      });
      await helpers.getChatRunEvents({ runId: sent.body.response.runId });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.thread.title).toBe('');
      expect(loaded.messages[0]!.parts).toContainEqual(
        expect.objectContaining({ type: 'attachment', fileName: 'image.png', kind: 'image' }),
      );
    });

    it('attaches uploaded files to the user message, names an untitled thread after one, and lets no other message reuse it', async () => {
      const { threadId } = await arrange({ turns: [{ text: 'It is a CSV file.' }] });
      const upload = await helpers.uploadChatAttachment({ threadId, file: csv('Coffee'), filename: 'october.csv' });
      const attachmentId = upload.attachment!.id;

      const sent = await helpers.sendChatMessage({ threadId, payload: { text: '', attachmentIds: [attachmentId] } });
      expect(sent.statusCode).toBe(202);
      await helpers.getChatRunEvents({ runId: sent.body.response.runId });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      expect(loaded.thread.title).toBe('october');
      expect(loaded.messages[0]!.parts).toContainEqual({
        type: 'attachment',
        id: expect.any(String),
        attachmentId,
        fileName: 'october.csv',
        mimeType: expect.any(String),
        kind: 'csv',
      });
      const stored = await ChatAttachments.findByPk(attachmentId);
      expect(stored!.messageId).toBe(sent.body.response.userMessageId);

      const reused = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Again', attachmentIds: [attachmentId] },
      });
      expect(reused.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('answers 422 for more than the allowed number of attachments', async () => {
      const { threadId } = await arrange({ turns: [] });
      const ids = Array.from(
        { length: CHAT_ATTACHMENTS_PER_MESSAGE + 1 },
        () => '00000000-0000-7000-8000-000000000000',
      );

      const sent = await helpers.sendChatMessage({ threadId, payload: { text: 'Too many', attachmentIds: ids } });

      expect(sent.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('answers 404 for an attachment that does not exist or belongs to another thread', async () => {
      const { threadId } = await arrange({ turns: [] });
      const otherThread = await helpers.createChatThread({ raw: true });
      const foreign = await helpers.uploadChatAttachment({ threadId: otherThread.id, file: csv('Elsewhere') });

      const unknown = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Look', attachmentIds: ['00000000-0000-7000-8000-000000000000'] },
      });
      const wrongThread = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Look', attachmentIds: [foreign.attachment!.id] },
      });

      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(wrongThread.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('answers 422 when the attachments together hold more text than one message may carry, and sends nothing', async () => {
      const { threadId } = await arrange({ turns: [] });
      const first = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.from('a'.repeat(170_000)),
        filename: 'first.txt',
      });
      const second = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.from('b'.repeat(170_000)),
        filename: 'second.txt',
      });
      expect([first.statusCode, second.statusCode]).toEqual([201, 201]);

      const sent = await helpers.sendChatMessage({
        threadId,
        payload: { text: 'Read both', attachmentIds: [first.attachment!.id, second.attachment!.id] },
      });

      expect(sent.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await ChatMessages.count({ where: { threadId } })).toBe(0);
      expect(await ChatAttachments.count({ where: { threadId, messageId: null } })).toBe(2);
    });
  });

  describe('Clarification answers', () => {
    it('records the answer on the clarification and in the user message, and refuses an unknown or a second answer', async () => {
      const { threadId } = await arrange({ turns: [{ text: 'Thanks, noted.' }] });
      const clarificationId = '5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f';
      await ChatMessages.create({
        threadId,
        userId: await helpers.getTestUserId(),
        role: 'assistant',
        status: 'complete',
        runId: '11111111-1111-4111-8111-111111111111',
        parts: [
          {
            type: 'clarification',
            id: clarificationId,
            question: 'Which account?',
            options: [
              { id: 'checking', label: 'Checking' },
              { id: 'savings', label: 'Savings' },
            ],
            allowFreeText: false,
            multiSelect: false,
          },
        ],
      });

      const unknown = await helpers.sendChatMessage({
        threadId,
        payload: {
          text: '',
          clarificationAnswer: { clarificationId: '00000000-0000-7000-8000-000000000000', optionIds: ['checking'] },
        },
      });
      const badOption = await helpers.sendChatMessage({
        threadId,
        payload: { text: '', clarificationAnswer: { clarificationId, optionIds: ['brokerage'] } },
      });
      const answered = await helpers.sendChatMessage({
        threadId,
        payload: { text: '', clarificationAnswer: { clarificationId, optionIds: ['savings'] } },
      });
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(badOption.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(answered.statusCode).toBe(202);
      await helpers.getChatRunEvents({ runId: answered.body.response.runId });

      const loaded = await helpers.getChatThread({ threadId, raw: true });
      const asked = loaded.messages.find(
        (message) => message.role === 'assistant' && message.parts[0]?.type === 'clarification',
      );
      expect(asked!.parts[0]).toMatchObject({ answer: { optionIds: ['savings'] } });
      const reply = loaded.messages.find((message) => message.id === answered.body.response.userMessageId)!;
      expect(reply.plainText).toBe('Savings');
      expect(reply.parts).toContainEqual({
        type: 'clarificationAnswer',
        id: expect.any(String),
        clarificationId,
        optionIds: ['savings'],
      });

      const again = await helpers.sendChatMessage({
        threadId,
        payload: { text: '', clarificationAnswer: { clarificationId, optionIds: ['checking'] } },
      });
      expect(again.statusCode).toBe(ERROR_CODES.ConflictError);
    });
  });
});
