import { API_ERROR_CODES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

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
