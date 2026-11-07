import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatThreads from '@models/chat-threads.model';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { errorMessage } from '@tests/helpers/user-settings';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import {
  CUSTOM_ENDPOINT_BASE_URL,
  CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
  CUSTOM_ENDPOINT_UNKNOWN_MODEL,
} from '@tests/mocks/openai-compatible/mock-api';
import { HttpResponse, delay, http } from 'msw';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

/** A model the first connection (llama3.2) also serves; the mock endpoints serve every name but one. */
const FIRST_OVERRIDE_MODEL = 'llama3.2:70b';
/** The default model of the second connection. */
const SECOND_MODEL = 'qwen2.5';

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * Two connections: the first is the default, the second answers on its own endpoint and model. The scripts
 * answer every request to their endpoints, probes included, so a test that picks a model (which probes the
 * provider) defers them until the pick is made.
 */
async function arrangeConnections({ deferScripts = false }: { deferScripts?: boolean } = {}) {
  const first = await helpers.createFirstConnection();
  const second = await helpers.createSecondConnection();
  const firstScript = createChatScript({ turns: [{ text: 'From the first' }], baseUrl: CUSTOM_ENDPOINT_BASE_URL });
  const secondScript = createChatScript({
    turns: [{ text: 'From the second' }],
    baseUrl: CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
  });
  const installScripts = () => global.mswMockServer.use(firstScript.handler, secondScript.handler);
  if (!deferScripts) installScripts();

  return { first, second, firstScript, secondScript, installScripts };
}

describe('Chat thread connection', () => {
  describe('POST /chat/threads', () => {
    it('starts the thread on the connection named in the request', async () => {
      const { second } = await arrangeConnections();

      const thread = await helpers.createChatThread({ connectionId: second.id, raw: true });

      expect(thread.connectionId).toBe(second.id);
      expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.connectionId).toBe(second.id);
      expect((await helpers.listChatThreads({ raw: true })).threads[0]!.connectionId).toBe(second.id);
    });

    it('takes the connection of the most recently used thread when none is named', async () => {
      const { first, second } = await arrangeConnections();
      const older = await helpers.createChatThread({ connectionId: first.id, raw: true });
      await helpers.createChatThread({ connectionId: second.id, raw: true });
      await ChatThreads.update({ lastMessageAt: new Date(Date.now() - 60_000) }, { where: { id: older.id } });

      const inherited = await helpers.createChatThread({ raw: true });

      expect(inherited.connectionId).toBe(second.id);
    });

    it('takes the default connection when the last thread connection is gone or flagged down', async () => {
      const { first, second } = await arrangeConnections();
      await helpers.createChatThread({ connectionId: second.id, raw: true });

      await helpers.patchStoredConnection({
        connectionId: second.id,
        patch: { status: 'invalid', lastError: 'down' },
      });
      expect((await helpers.createChatThread({ raw: true })).connectionId).toBe(first.id);

      await helpers.patchStoredConnection({ connectionId: second.id, patch: { status: 'valid' } });
      await helpers.deleteAiConnection({ id: second.id });
      expect((await helpers.createChatThread({ raw: true })).connectionId).toBe(first.id);
    });

    it('takes the default connection for the very first thread', async () => {
      const { first } = await arrangeConnections();

      expect((await helpers.createChatThread({ raw: true })).connectionId).toBe(first.id);
    });

    it('starts with no connection when nothing can answer', async () => {
      expect((await helpers.createChatThread({ raw: true })).connectionId).toBeNull();
    });

    it('refuses another user’s connection, one that does not exist, and the included model when none serves chat', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({ cookies: other.cookies, fn: () => helpers.createFirstConnection() });
      await helpers.createFirstConnection();

      const foreignResponse = await helpers.createChatThread({ connectionId: foreign.id });
      expect(foreignResponse.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(errorMessage({ response: foreignResponse })).toBe(t({ key: 'ai.connectionNotFound' }));

      const unknown = await helpers.createChatThread({ connectionId: '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a' });
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);

      const included = await helpers.createChatThread({ connectionId: null });
      expect(included.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorMessage({ response: included })).toBe(t({ key: 'chat.includedModelUnavailable' }));

      expect((await helpers.listChatThreads({ raw: true })).threads).toEqual([]);
    });
  });

  describe('model choice on POST /chat/threads', () => {
    it('starts the thread on a model of the connection and reports it everywhere the thread is read', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });

      const thread = await helpers.createChatThread({
        connectionId: first.id,
        modelId: FIRST_OVERRIDE_MODEL,
        raw: true,
      });

      expect(thread.modelId).toBe(FIRST_OVERRIDE_MODEL);
      expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.modelId).toBe(
        FIRST_OVERRIDE_MODEL,
      );
      expect((await helpers.listChatThreads({ raw: true })).threads[0]!.modelId).toBe(FIRST_OVERRIDE_MODEL);
    });

    it('starts on the connection default when no model is named', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });

      expect((await helpers.createChatThread({ connectionId: first.id, raw: true })).modelId).toBeNull();
    });

    it('keeps the connection default when the named model is the default', async () => {
      const { second } = await arrangeConnections({ deferScripts: true });

      const thread = await helpers.createChatThread({ connectionId: second.id, modelId: SECOND_MODEL, raw: true });

      expect(thread.modelId).toBeNull();
    });

    it('refuses a model the connection cannot serve, and a model without a connection', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });

      const unserved = await helpers.createChatThread({
        connectionId: first.id,
        modelId: CUSTOM_ENDPOINT_UNKNOWN_MODEL,
      });
      expect(unserved.statusCode).toBe(ERROR_CODES.ValidationError);

      const withoutConnection = await helpers.createChatThread({ modelId: FIRST_OVERRIDE_MODEL });
      expect(withoutConnection.statusCode).toBe(ERROR_CODES.ValidationError);

      expect((await helpers.listChatThreads({ raw: true })).threads).toEqual([]);
    });

    it('inherits the model together with the connection of the most recently used thread', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });
      await helpers.createChatThread({ connectionId: first.id, modelId: FIRST_OVERRIDE_MODEL, raw: true });

      const inherited = await helpers.createChatThread({ raw: true });

      expect(inherited).toMatchObject({ connectionId: first.id, modelId: FIRST_OVERRIDE_MODEL });
    });

    it('starts on the connection default when the request says so outright, instead of inheriting the model', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });
      await helpers.createChatThread({ connectionId: first.id, modelId: FIRST_OVERRIDE_MODEL, raw: true });

      const explicit = await helpers.createChatThread({ modelId: null, raw: true });
      const withConnection = await helpers.createChatThread({ connectionId: first.id, modelId: null, raw: true });

      expect(explicit).toMatchObject({ connectionId: first.id, modelId: null });
      expect(withConnection).toMatchObject({ connectionId: first.id, modelId: null });
    });

    it('drops the inherited model when the connection can no longer be inherited', async () => {
      const { first, second } = await arrangeConnections({ deferScripts: true });
      await helpers.createChatThread({ connectionId: second.id, modelId: 'qwen2.5-coder', raw: true });
      await helpers.patchStoredConnection({
        connectionId: second.id,
        patch: { status: 'invalid', lastError: 'down' },
      });

      const inherited = await helpers.createChatThread({ raw: true });

      expect(inherited).toMatchObject({ connectionId: first.id, modelId: null });
    });
  });

  describe('GET /chat/default-connection', () => {
    it('names the connection a new thread would start on', async () => {
      const { first, second } = await arrangeConnections();
      expect(await helpers.getChatDefaultConnection({ raw: true })).toEqual({ connectionId: first.id, modelId: null });

      await helpers.createChatThread({ connectionId: second.id, raw: true });
      expect(await helpers.getChatDefaultConnection({ raw: true })).toEqual({
        connectionId: second.id,
        modelId: null,
      });
    });

    it('names the model a new thread would inherit', async () => {
      const { first } = await arrangeConnections({ deferScripts: true });
      await helpers.createChatThread({ connectionId: first.id, modelId: FIRST_OVERRIDE_MODEL, raw: true });

      expect(await helpers.getChatDefaultConnection({ raw: true })).toEqual({
        connectionId: first.id,
        modelId: FIRST_OVERRIDE_MODEL,
      });
    });

    it('answers null when nothing can answer', async () => {
      expect(await helpers.getChatDefaultConnection({ raw: true })).toEqual({ connectionId: null, modelId: null });
    });
  });

  describe('PATCH /chat/threads/:id', () => {
    it('switches the thread to another connection of the user', async () => {
      const { first, second } = await arrangeConnections();
      const thread = await helpers.createChatThread({ raw: true });
      expect(thread.connectionId).toBe(first.id);

      const updated = await helpers.updateChatThread({ threadId: thread.id, payload: { connectionId: second.id } });

      expect(updated.statusCode).toBe(200);
      expect(updated.body.response.connectionId).toBe(second.id);
      expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.connectionId).toBe(second.id);
    });

    describe('model choice', () => {
      it('picks a model of the thread connection, and null returns to the connection default', async () => {
        const { first } = await arrangeConnections({ deferScripts: true });
        const thread = await helpers.createChatThread({ raw: true });

        const picked = await helpers.updateChatThread({
          threadId: thread.id,
          payload: { modelId: FIRST_OVERRIDE_MODEL },
        });
        expect(picked.statusCode).toBe(200);
        expect(picked.body.response).toMatchObject({ connectionId: first.id, modelId: FIRST_OVERRIDE_MODEL });

        const reset = await helpers.updateChatThread({ threadId: thread.id, payload: { modelId: null } });
        expect(reset.body.response.modelId).toBeNull();
      });

      it('resets the model to the default of the new connection when the connection changes', async () => {
        const { first, second } = await arrangeConnections({ deferScripts: true });
        const thread = await helpers.createChatThread({
          connectionId: first.id,
          modelId: FIRST_OVERRIDE_MODEL,
          raw: true,
        });

        const switched = await helpers.updateChatThread({ threadId: thread.id, payload: { connectionId: second.id } });

        expect(switched.body.response).toMatchObject({ connectionId: second.id, modelId: null });
      });

      it('applies a model named together with the new connection to that connection', async () => {
        const { second } = await arrangeConnections({ deferScripts: true });
        const thread = await helpers.createChatThread({ raw: true });

        const switched = await helpers.updateChatThread({
          threadId: thread.id,
          payload: { connectionId: second.id, modelId: 'qwen2.5-coder' },
        });

        expect(switched.body.response).toMatchObject({ connectionId: second.id, modelId: 'qwen2.5-coder' });
      });

      it('refuses a model the connection cannot serve and keeps the thread as it was', async () => {
        const { first } = await arrangeConnections({ deferScripts: true });
        const thread = await helpers.createChatThread({
          connectionId: first.id,
          modelId: FIRST_OVERRIDE_MODEL,
          raw: true,
        });

        const response = await helpers.updateChatThread({
          threadId: thread.id,
          payload: { modelId: CUSTOM_ENDPOINT_UNKNOWN_MODEL },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.modelId).toBe(
          FIRST_OVERRIDE_MODEL,
        );
      });

      it('checks the model with the provider before locking the thread, so a slow provider blocks nothing else', async () => {
        const { first } = await arrangeConnections({ deferScripts: true });
        const thread = await helpers.createChatThread({ connectionId: first.id, raw: true });
        const SLOW_PROVIDER_MS = 2_000;
        global.mswMockServer.use(
          http.post(`${CUSTOM_ENDPOINT_BASE_URL}/chat/completions`, async () => {
            await delay(SLOW_PROVIDER_MS);
            return HttpResponse.json({
              id: 'x',
              object: 'chat.completion',
              created: 1,
              model: FIRST_OVERRIDE_MODEL,
              choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            });
          }),
        );

        const slow = helpers.updateChatThread({ threadId: thread.id, payload: { modelId: FIRST_OVERRIDE_MODEL } });
        await settle();
        const startedAt = Date.now();
        const renamed = await helpers.updateChatThread({ threadId: thread.id, payload: { title: 'Renamed' } });

        expect(renamed.statusCode).toBe(200);
        expect(Date.now() - startedAt).toBeLessThan(SLOW_PROVIDER_MS / 2);
        expect((await slow).statusCode).toBe(200);
      });
    });

    it('refuses a connection that is not the user’s or does not exist, and changes nothing', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({ cookies: other.cookies, fn: () => helpers.createFirstConnection() });
      const { first } = await arrangeConnections();
      const thread = await helpers.createChatThread({ raw: true });

      for (const connectionId of [foreign.id, '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a']) {
        const response = await helpers.updateChatThread({ threadId: thread.id, payload: { connectionId } });
        expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      }

      const invalidShape = await helpers.updateChatThread({ threadId: thread.id, payload: { connectionId: 'nope' } });
      expect(invalidShape.statusCode).toBe(ERROR_CODES.ValidationError);

      expect((await helpers.getChatThread({ threadId: thread.id, raw: true })).thread.connectionId).toBe(first.id);
    });

    it('refuses the included model when none serves chat', async () => {
      await arrangeConnections();
      const thread = await helpers.createChatThread({ raw: true });

      const response = await helpers.updateChatThread({ threadId: thread.id, payload: { connectionId: null } });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
