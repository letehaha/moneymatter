import { CHAT_RETENTION_OPTIONS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatThreads from '@models/chat-threads.model';
import * as helpers from '@tests/helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

const readThread = async ({ threadId }: { threadId: string }) => {
  const row = await ChatThreads.findByPk(threadId);
  return { lastMessageAt: row!.lastMessageAt, expiresAt: row!.expiresAt, pinned: row!.pinned };
};

describe('Chat retention (PUT /chat/settings)', () => {
  it('sets the window from the last message for every unpinned thread and leaves pinned threads without expiry', async () => {
    const recent = await helpers.createChatThread({ title: 'Recent', raw: true });
    const old = await helpers.createChatThread({ title: 'Old', raw: true });
    const pinned = await helpers.createChatThread({ title: 'Pinned', raw: true });
    await helpers.updateChatThread({ threadId: pinned.id, payload: { pinned: true } });
    const lastMessageAt = new Date(Date.now() - 20 * DAY_MS);
    await ChatThreads.update({ lastMessageAt }, { where: { id: old.id } });

    const response = await helpers.setChatRetention({ retentionDays: 7 });

    expect(response.statusCode).toBe(200);
    expect(response.body.response).toEqual({ retentionDays: 7 });
    const recentRow = await readThread({ threadId: recent.id });
    expect(recentRow.expiresAt!.getTime()).toBe(recentRow.lastMessageAt.getTime() + 7 * DAY_MS);
    const oldRow = await readThread({ threadId: old.id });
    expect(oldRow.expiresAt!.getTime()).toBe(lastMessageAt.getTime() + 7 * DAY_MS);
    expect((await readThread({ threadId: pinned.id })).expiresAt).toBeNull();
    expect(await helpers.readStoredChatRetention({ userId: await helpers.getTestUserId() })).toBe(7);
  });

  it.each(CHAT_RETENTION_OPTIONS)('accepts %s days', async (retentionDays) => {
    const thread = await helpers.createChatThread({ raw: true });

    const response = await helpers.setChatRetention({ retentionDays });

    expect(response.statusCode).toBe(200);
    const row = await readThread({ threadId: thread.id });
    expect(row.expiresAt!.getTime()).toBe(row.lastMessageAt.getTime() + retentionDays * DAY_MS);
  });

  it('clears every expiry for "never" and keeps it cleared for threads created afterwards', async () => {
    const existing = await helpers.createChatThread({ title: 'Existing', raw: true });
    expect(existing.expiresAt).not.toBeNull();

    const response = await helpers.setChatRetention({ retentionDays: null });

    expect(response.statusCode).toBe(200);
    expect(response.body.response).toEqual({ retentionDays: null });
    expect((await readThread({ threadId: existing.id })).expiresAt).toBeNull();
    expect(await helpers.readStoredChatRetention({ userId: await helpers.getTestUserId() })).toBeNull();

    const created = await helpers.createChatThread({ title: 'Created later', raw: true });
    expect(created.expiresAt).toBeNull();
  });

  it('brings expiry back when the user goes from "never" to a window', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    await helpers.setChatRetention({ retentionDays: null });

    await helpers.setChatRetention({ retentionDays: 90 });

    const row = await readThread({ threadId: thread.id });
    expect(row.expiresAt!.getTime()).toBe(row.lastMessageAt.getTime() + 90 * DAY_MS);
  });

  it('uses the chosen window for a thread unpinned later', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    await helpers.updateChatThread({ threadId: thread.id, payload: { pinned: true } });
    await helpers.setChatRetention({ retentionDays: 365 });

    const unpinned = await helpers.updateChatThread({ threadId: thread.id, payload: { pinned: false }, raw: true });

    expect(new Date(unpinned.expiresAt!).getTime()).toBe(new Date(unpinned.lastMessageAt).getTime() + 365 * DAY_MS);
  });

  it('answers 422 to a value outside the options and to a missing value, and changes nothing', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    const before = await readThread({ threadId: thread.id });

    const unsupported = await helpers.setChatRetention({ retentionDays: 14 });
    const missing = await helpers.makeRequest({ method: 'put', url: '/chat/settings', payload: { other: 1 } });
    const text = await helpers.makeRequest({ method: 'put', url: '/chat/settings', payload: { retentionDays: '7' } });

    expect(unsupported.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(text.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await readThread({ threadId: thread.id })).toEqual(before);
    expect(await helpers.readStoredChatRetention({ userId: await helpers.getTestUserId() })).toBeUndefined();
  });

  it('does not touch another user’s threads or setting', async () => {
    const mine = await helpers.createChatThread({ title: 'Mine', raw: true });
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const theirs = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.createChatThread({ title: 'Theirs', raw: true }),
    });
    const theirsBefore = await readThread({ threadId: theirs.id });

    await helpers.setChatRetention({ retentionDays: 7 });

    expect(await readThread({ threadId: theirs.id })).toEqual(theirsBefore);
    expect((await readThread({ threadId: mine.id })).expiresAt!.getTime()).toBe(
      (await readThread({ threadId: mine.id })).lastMessageAt.getTime() + 7 * DAY_MS,
    );
  });

  it('is not undone by a settings PUT that carries a stale retention', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    await helpers.setChatRetention({ retentionDays: 7 });
    const before = await readThread({ threadId: thread.id });

    const response = await helpers.makeRequest({
      method: 'put',
      url: '/user/settings',
      payload: { locale: 'uk', ai: { chat: { retentionDays: 30 } } },
    });

    expect(response.statusCode).toBe(200);
    expect(await helpers.readStoredChatRetention({ userId: await helpers.getTestUserId() })).toBe(7);
    expect(await readThread({ threadId: thread.id })).toEqual(before);
    const created = await helpers.createChatThread({ raw: true });
    expect(new Date(created.expiresAt!).getTime()).toBe(new Date(created.lastMessageAt).getTime() + 7 * DAY_MS);
  });

  it('is not undone by a settings PATCH that carries a stale retention', async () => {
    const thread = await helpers.createChatThread({ raw: true });
    await helpers.setChatRetention({ retentionDays: 90 });
    const before = await readThread({ threadId: thread.id });

    const response = await helpers.makeRequest({
      method: 'patch',
      url: '/user/settings',
      payload: { ai: { chat: { retentionDays: 30 } } },
    });

    expect(response.statusCode).toBe(200);
    expect(await helpers.readStoredChatRetention({ userId: await helpers.getTestUserId() })).toBe(90);
    expect(await readThread({ threadId: thread.id })).toEqual(before);
  });
});
