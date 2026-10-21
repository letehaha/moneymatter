import { AI_PROVIDER, API_ERROR_CODES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import { CUSTOM_ENDPOINT_MODEL, getCustomEndpointSuccessMock } from '@tests/mocks/openai-compatible/mock-api';

const DAY_MS = 24 * 60 * 60 * 1000;

failOnUnscriptedChatRequests();

const becomeReadOnly = () => helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY_MS) });

describe('Chat for a read-only user (lapsed plan)', () => {
  it('lets a user who is read-only before their first chat create, rename, pin and delete a thread', async () => {
    await becomeReadOnly();

    const created = await helpers.createChatThread({ title: 'First chat' });
    expect(created.statusCode).toBe(201);
    const threadId = created.body.response.id;

    const renamed = await helpers.updateChatThread({ threadId, payload: { title: 'Renamed' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.body.response.title).toBe('Renamed');

    const pinned = await helpers.updateChatThread({ threadId, payload: { pinned: true } });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.body.response.pinned).toBe(true);

    const removed = await helpers.deleteChatThread({ threadId });
    expect(removed.statusCode).toBe(200);
    expect((await helpers.listChatThreads({ raw: true })).threads).toEqual([]);
  });

  it('lets a read-only user attach a document and an image and read the image back', async () => {
    const thread = await helpers.createChatThread({ title: 'Statement help', raw: true });
    await becomeReadOnly();

    const csv = await helpers.uploadChatAttachment({
      threadId: thread.id,
      file: Buffer.from('date,description,amount\n2026-10-01,Coffee,-3.50\n'),
      filename: 'october.csv',
    });
    const image = await helpers.uploadChatAttachment({
      threadId: thread.id,
      file: Buffer.from(PNG_1X1_BASE64, 'base64'),
      filename: 'receipt.png',
    });
    const served = await helpers.getChatAttachmentImage({ attachmentId: image.attachment!.id });

    expect(csv.statusCode).toBe(201);
    expect(image.statusCode).toBe(201);
    expect(served.statusCode).toBe(200);
  });

  it('lets a read-only user send a message and cancel a run', async () => {
    // A plan lapses only in cloud mode, where the outbound URL guard admits public addresses alone.
    const baseUrl = 'http://93.184.216.34/v1';
    global.mswMockServer.use(getCustomEndpointSuccessMock({ baseUrl }));
    await helpers.createAiConnection({
      provider: AI_PROVIDER.custom,
      name: 'Public endpoint',
      baseUrl,
      model: CUSTOM_ENDPOINT_MODEL,
      raw: true,
    });
    global.mswMockServer.use(
      createChatScript({ baseUrl, turns: [{ text: ['Working', ' on it'], pieceDelayMs: 8_000 }] }).handler,
    );
    const thread = await helpers.createChatThread({ raw: true });
    await becomeReadOnly();

    const sent = await helpers.sendChatMessage({ threadId: thread.id, payload: { text: 'Hello' } });
    expect(sent.statusCode).toBe(202);
    const cancelled = await helpers.cancelChatRun({ runId: sent.body.response.runId });
    const stream = await helpers.getChatRunEvents({ runId: sent.body.response.runId });

    expect(cancelled.statusCode).toBe(200);
    expect(stream.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'cancelled' });
  });

  it('lets a read-only user refresh, reject and comment on a card, and answers 402 to approve, approve-all and edit', async () => {
    const baseUrl = 'http://93.184.216.34/v1';
    global.mswMockServer.use(getCustomEndpointSuccessMock({ baseUrl }));
    await helpers.createAiConnection({
      provider: AI_PROVIDER.custom,
      name: 'Public endpoint',
      baseUrl,
      model: CUSTOM_ENDPOINT_MODEL,
      raw: true,
    });
    global.mswMockServer.use(
      createChatScript({
        baseUrl,
        turns: [
          {
            toolCalls: [
              { name: 'create_category', arguments: { name: 'Read-only Refresh', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Read-only Reject', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Read-only Comment', color: '#4CAF50' } },
            ],
          },
          { text: 'Done.' },
          { text: 'Noted.' },
        ],
      }).handler,
    );
    const thread = await helpers.createChatThread({ raw: true });
    const sent = await helpers.sendChatMessage({ threadId: thread.id, payload: { text: 'Add categories' }, raw: true });
    const { events } = await helpers.getChatRunEvents({ runId: sent.runId });
    const cards = events.flatMap((event) => (event.type === 'proposal.upserted' ? [event.card] : []));
    expect(cards).toHaveLength(3);
    const [toRefresh, toReject, toComment] = cards;
    await becomeReadOnly();

    const refreshed = await helpers.refreshChatProposal({ proposalId: toRefresh!.id });
    const rejected = await helpers.rejectChatProposal({ proposalId: toReject!.id });
    const commented = await helpers.commentOnChatProposal({ proposalId: toComment!.id, text: 'Rename it' });
    await helpers.getChatRunEvents({ runId: commented.body.response.runId });

    expect(refreshed.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(200);
    expect(commented.statusCode).toBe(202);

    const approve = await helpers.approveChatProposal({ proposalId: toComment!.id, payload: { revision: 1 } });
    const approveAll = await helpers.approveAllChatMessage({
      messageId: sent.messageId,
      payload: { revisions: { [toComment!.id]: 1 } },
    });
    const edit = await helpers.editChatProposal({
      proposalId: toComment!.id,
      payload: { revision: 1, args: { name: 'Renamed' } },
    });
    for (const refused of [approve, approveAll, edit]) {
      expect(refused.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((refused.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.planRequired);
    }
    expect((await helpers.getChatProposal({ proposalId: toComment!.id, raw: true })).status).toBe('pending');
  });

  it('lets a read-only user change retention', async () => {
    await becomeReadOnly();

    const response = await helpers.setChatRetention({ retentionDays: 90 });

    expect(response.statusCode).toBe(200);
    expect(response.body.response).toEqual({ retentionDays: 90 });
  });

  it('still lets a read-only user read their threads', async () => {
    const thread = await helpers.createChatThread({ title: 'Before the plan lapsed', raw: true });
    await becomeReadOnly();

    const list = await helpers.listChatThreads();
    const detail = await helpers.getChatThread({ threadId: thread.id });

    expect(list.statusCode).toBe(200);
    expect(list.body.response.threads.map((item) => item.id)).toEqual([thread.id]);
    expect(detail.statusCode).toBe(200);
  });

  it('keeps answering 402 to an unrelated write route', async () => {
    await becomeReadOnly();

    const write = await helpers.makeRequest({
      method: 'post',
      url: '/accounts',
      payload: helpers.buildAccountPayload(),
    });

    expect(write.statusCode).toBe(ERROR_CODES.PaymentRequired);
    expect(write.body.response.code).toBe(API_ERROR_CODES.planRequired);
  });
});
