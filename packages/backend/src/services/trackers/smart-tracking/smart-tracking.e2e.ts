import {
  NOTIFICATION_TYPES,
  SHARE_PERMISSIONS,
  TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
  TRANSACTION_TRANSFER_NATURE,
  type RecordId,
  type TrackerAiPreWindowDays,
  asDecimal,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { runTrackerSmartScanCron } from '@root/crons/tracker-smart-scan';
import * as helpers from '@tests/helpers';
import { enableServerModel, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { createFirstConnection } from '@tests/helpers/user-settings';
import { GEMINI_API_URL } from '@tests/mocks/gemini/mock-api';
import { getCustomEndpointDynamicMock } from '@tests/mocks/openai-compatible/mock-api';
import { subDays } from 'date-fns';
import { HttpResponse, http } from 'msw';

/** The scan runs on a queue with no HTTP trigger, so these tests wait for it or call the cron directly. */

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = ({ days }: { days: number }) => subDays(new Date(), days).toISOString();

const userPrompt = ({ messages = [] }: { messages?: { role: string; content: unknown }[] }): string => {
  const content = messages.find((message) => message.role === 'user')?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? '').join('') : '';
};

/**
 * Answers every scan call with `scores` keyed by transaction note, and records which notes
 * each call was sent. Register it after `createFirstConnection`, whose probe it would answer.
 */
const mockTrackerAi = ({ scores = {}, delayMs }: { scores?: Record<string, number>; delayMs?: number } = {}) => {
  const calls: { notes: string[]; prompt: string }[] = [];
  global.mswMockServer.use(
    getCustomEndpointDynamicMock({
      delayMs,
      respond: ({ body }) => {
        const prompt = userPrompt(body);
        const [, table] = prompt.split('CANDIDATES:\n');
        if (!table) return 'ok';

        const rows = table.split('\n').slice(1);
        const notes: string[] = [];
        const matches = rows.flatMap((row) => {
          const [id, , , , , , note = ''] = row.split('|');
          notes.push(note);
          const score = scores[note];
          return score === undefined ? [] : [{ id, score, reason: `Fits ${note}` }];
        });
        calls.push({ notes, prompt });
        return JSON.stringify({ matches });
      },
    }),
  );
  return {
    calls,
    sentNotes: () => calls.flatMap((call) => call.notes).toSorted(),
    reset: () => calls.splice(0, calls.length),
  };
};

const createExpense = async ({ accountId, note, time }: { accountId: RecordId; note: string; time: string }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, note, time, amount: 100 }),
    raw: true,
  });
  return tx!;
};

const createLisbonTracker = async ({
  startDays = 30,
  endDays,
  aiPreWindowDays,
}: { startDays?: number; endDays?: number; aiPreWindowDays?: TrackerAiPreWindowDays } = {}) =>
  helpers.createTracker({
    name: 'Lisbon trip',
    startDate: daysAgo({ days: startDays }),
    endDate: endDays === undefined ? null : daysAgo({ days: endDays }),
    aiPreWindowDays,
    raw: true,
  });

const enableSmartTracking = async ({
  id,
  description = 'Everything spent on the Lisbon trip',
}: {
  id: string;
  description?: string;
}) => {
  const response = await helpers.editTracker({
    id,
    params: { aiEnabled: true, aiDescription: description },
    raw: false,
  });
  expect(response.statusCode).toBe(200);
  await helpers.waitForTrackerScanToSettle({ id });
};

const rescan = async ({ id, description }: { id: string; description: string }) => {
  expect((await helpers.editTracker({ id, params: { aiDescription: description }, raw: false })).statusCode).toBe(200);
  await helpers.waitForTrackerScanToSettle({ id });
};

const trackerTransactionCount = async ({ id }: { id: string }) =>
  (await helpers.getTrackerStats({ id, raw: true }))!.summary.transactionsCount;

const matchNotifications = async () =>
  (await helpers.getNotifications({ raw: true })).filter(
    (notification) => notification.type === NOTIFICATION_TYPES.trackerAiMatches,
  );

describe('Smart tracking', () => {
  useSelfHostWithoutServerAiKeys();

  describe('POST /trackers with smart tracking', () => {
    it('scans right away when created with smart tracking on', async () => {
      await createFirstConnection();
      const ai = mockTrackerAi({ scores: { 'Hotel Lisbon': 0.6 } });
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, note: 'Hotel Lisbon', time: daysAgo({ days: 5 }) });

      const tracker = await helpers.createTracker({
        name: 'Lisbon trip',
        startDate: daysAgo({ days: 30 }),
        aiEnabled: true,
        aiDescription: 'Everything spent on the Lisbon trip',
        raw: true,
      });
      await helpers.waitForTrackerScanToSettle({ id: tracker.id });

      expect(ai.sentNotes()).toEqual(['Hotel Lisbon']);
      const suggestions = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
      expect(suggestions.pending.map((suggestion) => suggestion.transaction.note)).toEqual(['Hotel Lisbon']);
      expect(suggestions.scan.lastScannedAt).toEqual(expect.any(String));
    });

    it('requires a description', async () => {
      const response = await helpers.createTracker({
        name: 'Lisbon trip',
        startDate: daysAgo({ days: 30 }),
        aiEnabled: true,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('requires a start date', async () => {
      const response = await helpers.createTracker({
        name: 'Lisbon trip',
        aiEnabled: true,
        aiDescription: 'Trip',
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('PUT /trackers/:id validation', () => {
    it('requires a description to turn smart tracking on', async () => {
      const tracker = await createLisbonTracker();

      const response = await helpers.editTracker({ id: tracker.id, params: { aiEnabled: true }, raw: false });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('requires a start date', async () => {
      const tracker = await helpers.createTracker({ name: 'No dates', raw: true });

      const response = await helpers.editTracker({
        id: tracker.id,
        params: { aiEnabled: true, aiDescription: 'Trip' },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects clearing the start date of a smart tracker', async () => {
      await createFirstConnection();
      mockTrackerAi();
      const tracker = await createLisbonTracker();
      await enableSmartTracking({ id: tracker.id });

      const response = await helpers.editTracker({ id: tracker.id, params: { startDate: null }, raw: false });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('can be enabled on a tracker with rules', async () => {
      await createFirstConnection();
      mockTrackerAi();
      const category = await helpers.addCustomCategory({ name: 'Travel', color: '#FF0000', raw: true });
      const tracker = await helpers.createTracker({
        name: 'By category',
        rulesEnabled: true,
        categoryIds: [category.id],
        startDate: daysAgo({ days: 10 }),
        raw: true,
      });

      await enableSmartTracking({ id: tracker.id });
    });

    it('forbids a manage recipient from changing smart tracking fields', async () => {
      const tracker = await createLisbonTracker();
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.manage });

      const response = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.editTracker({ id: tracker.id, params: { aiDescription: 'Mine now' }, raw: false }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.Forbidden);
    });
  });

  it('links high scores, keeps middle scores pending and reports both', async () => {
    await createFirstConnection();
    const ai = mockTrackerAi({ scores: { 'Hotel Lisbon': 0.95, 'Airport taxi': 0.6, 'Corner shop': 0.3 } });
    const account = await helpers.createAccount({ raw: true });
    const hotel = await createExpense({ accountId: account.id, note: 'Hotel Lisbon', time: daysAgo({ days: 5 }) });
    const taxi = await createExpense({ accountId: account.id, note: 'Airport taxi', time: daysAgo({ days: 4 }) });
    await createExpense({ accountId: account.id, note: 'Corner shop', time: daysAgo({ days: 3 }) });
    const tracker = await createLisbonTracker();

    await enableSmartTracking({ id: tracker.id });

    expect(ai.sentNotes()).toEqual(['Airport taxi', 'Corner shop', 'Hotel Lisbon']);

    const suggestions = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
    expect(suggestions.pending).toEqual([
      {
        id: expect.any(String),
        score: 0.6,
        reason: 'Fits Airport taxi',
        transaction: expect.objectContaining({ id: taxi.id, amount: 100 }),
      },
    ]);
    expect(suggestions.aiMatched).toEqual([
      { id: expect.any(String), transactionId: hotel.id, reason: 'Fits Hotel Lisbon' },
    ]);
    expect(suggestions.scan).toEqual({
      status: 'idle',
      startedAt: null,
      lastScannedAt: expect.any(String),
      pausedReason: null,
    });
    expect(await trackerTransactionCount({ id: tracker.id })).toBe(1);

    const notifications = await helpers.getNotifications({ raw: true });
    expect(notifications.filter((notification) => notification.type === NOTIFICATION_TYPES.trackerAiMatches)).toEqual([
      expect.objectContaining({
        type: NOTIFICATION_TYPES.trackerAiMatches,
        payload: { trackerId: tracker.id, trackerName: 'Lisbon trip', linkedCount: 1, suggestedCount: 1 },
      }),
    ]);
  });

  it('sends only real, in-window transactions the tracker does not hold yet', async () => {
    await createFirstConnection();
    const ai = mockTrackerAi();
    const account = await helpers.createAccount({ raw: true });
    const otherAccount = await helpers.createAccount({ raw: true });
    const hiddenAccount = await helpers.createAccount({ raw: true });
    await helpers.updateAccount({ id: hiddenAccount.id, payload: { excludeFromStats: true }, raw: true });
    const tracker = await createLisbonTracker({ startDays: 30, endDays: 5, aiPreWindowDays: 14 });

    await createExpense({ accountId: account.id, note: 'In range', time: daysAgo({ days: 20 }) });
    await createExpense({ accountId: account.id, note: 'Deposit', time: daysAgo({ days: 40 }) });
    await createExpense({ accountId: account.id, note: 'Too early', time: daysAgo({ days: 50 }) });
    await createExpense({ accountId: account.id, note: 'Too late', time: daysAgo({ days: 2 }) });
    await createExpense({ accountId: hiddenAccount.id, note: 'Hidden account', time: daysAgo({ days: 20 }) });
    const linked = await createExpense({ accountId: account.id, note: 'Already linked', time: daysAgo({ days: 20 }) });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [linked.id] }, raw: true });
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, note: 'Transfer', time: daysAgo({ days: 20 }) }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 100,
        destinationAccountId: otherAccount.id,
      },
      raw: true,
    });
    await helpers.balanceAdjustment({
      id: account.id,
      payload: { targetBalance: asDecimal(12345), note: 'Adjustment', time: daysAgo({ days: 20 }) },
      raw: true,
    });

    await enableSmartTracking({ id: tracker.id });

    expect(ai.sentNotes()).toEqual(['Deposit', 'In range']);
    expect(ai.calls[0]!.prompt).toContain('ALREADY IN THIS TRACKER');
  });

  it('rescans only rows changed since the last scan', async () => {
    await createFirstConnection();
    const ai = mockTrackerAi();
    const account = await helpers.createAccount({ raw: true });
    await createExpense({ accountId: account.id, note: 'Alpha', time: daysAgo({ days: 10 }) });
    const bravo = await createExpense({ accountId: account.id, note: 'Bravo', time: daysAgo({ days: 10 }) });
    const tracker = await createLisbonTracker();
    await enableSmartTracking({ id: tracker.id });
    expect(ai.sentNotes()).toEqual(['Alpha', 'Bravo']);
    ai.reset();

    await helpers.updateTransaction({ id: bravo.id, payload: { note: 'Bravo edited' }, raw: true });
    await createExpense({ accountId: account.id, note: 'Charlie', time: daysAgo({ days: 25 }) });

    expect(await runTrackerSmartScanCron()).toEqual({ due: 1 });
    await helpers.waitForTrackerScanToSettle({ id: tracker.id });

    expect(ai.sentNotes()).toEqual(['Bravo edited', 'Charlie']);
  });

  it('never suggests a rejected transaction again', async () => {
    await createFirstConnection();
    const ai = mockTrackerAi({ scores: { Maybe: 0.6 } });
    const account = await helpers.createAccount({ raw: true });
    await createExpense({ accountId: account.id, note: 'Maybe', time: daysAgo({ days: 10 }) });
    await createExpense({ accountId: account.id, note: 'Other', time: daysAgo({ days: 10 }) });
    const tracker = await createLisbonTracker();
    await enableSmartTracking({ id: tracker.id });
    const [pending] = (await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).pending;

    await helpers.resolveTrackerSuggestions({
      id: tracker.id,
      action: 'reject',
      suggestionIds: [pending!.id],
      raw: true,
    });
    ai.reset();
    await rescan({ id: tracker.id, description: 'Only the Lisbon hotel' });

    expect(ai.sentNotes()).toEqual(['Other']);
    expect(ai.calls[0]!.prompt).toContain('REJECTED BY THE USER');
    expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).pending).toEqual([]);
  });

  describe('resolving suggestions', () => {
    const setup = async ({ scores }: { scores: Record<string, number> }) => {
      await createFirstConnection();
      mockTrackerAi({ scores });
      const account = await helpers.createAccount({ raw: true });
      for (const note of Object.keys(scores)) {
        await createExpense({ accountId: account.id, note, time: daysAgo({ days: 10 }) });
      }
      const tracker = await createLisbonTracker();
      await enableSmartTracking({ id: tracker.id });
      return { tracker, suggestions: await helpers.getTrackerSuggestions({ id: tracker.id, raw: true }) };
    };

    it('accepts a pending suggestion into the tracker and refuses to accept it twice', async () => {
      const { tracker, suggestions } = await setup({ scores: { One: 0.6, Two: 0.7 } });
      const one = suggestions.pending.find((suggestion) => suggestion.transaction.note === 'One')!;

      const accepted = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'accept',
        suggestionIds: [one.id],
      });

      expect(accepted.statusCode).toBe(200);
      const after = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
      expect(after.pending.map((suggestion) => suggestion.transaction.note)).toEqual(['Two']);
      expect(after.aiMatched).toEqual([{ id: one.id, transactionId: one.transaction.id, reason: 'Fits One' }]);
      expect(await trackerTransactionCount({ id: tracker.id })).toBe(1);

      const again = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'accept',
        suggestionIds: [one.id],
      });
      expect(again.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it('skips a suggestion and restores it', async () => {
      const { tracker, suggestions } = await setup({ scores: { Two: 0.7 } });
      const [two] = suggestions.pending;

      const rejected = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'reject',
        suggestionIds: [two!.id],
      });
      expect(rejected.statusCode).toBe(200);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).pending).toEqual([]);

      const restored = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'restore',
        suggestionIds: [two!.id],
      });
      expect(restored.statusCode).toBe(200);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).pending.map((s) => s.id)).toEqual([
        two!.id,
      ]);

      const restoredAgain = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'restore',
        suggestionIds: [two!.id],
      });
      expect(restoredAgain.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it('unlinks an auto-linked transaction on reject', async () => {
      const { tracker, suggestions } = await setup({ scores: { Sure: 0.9 } });
      expect(await trackerTransactionCount({ id: tracker.id })).toBe(1);

      const response = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'reject',
        suggestionIds: [suggestions.aiMatched[0]!.id],
      });

      expect(response.statusCode).toBe(200);
      expect(await trackerTransactionCount({ id: tracker.id })).toBe(0);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).aiMatched).toEqual([]);
    });

    it('unlinks an accepted suggestion on reject', async () => {
      const { tracker, suggestions } = await setup({ scores: { One: 0.6 } });
      const [one] = suggestions.pending;
      await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'accept',
        suggestionIds: [one!.id],
        raw: true,
      });
      expect(await trackerTransactionCount({ id: tracker.id })).toBe(1);

      const response = await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'reject',
        suggestionIds: [one!.id],
      });

      expect(response.statusCode).toBe(200);
      expect(await trackerTransactionCount({ id: tracker.id })).toBe(0);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).aiMatched).toEqual([]);
    });

    it('answers 404 to an id from another tracker', async () => {
      const { tracker } = await setup({ scores: { Two: 0.7 } });
      const other = await createLisbonTracker();
      const [pending] = (await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).pending;

      const response = await helpers.resolveTrackerSuggestions({
        id: other.id,
        action: 'accept',
        suggestionIds: [pending!.id],
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  it('treats a manual unlink as a rejection the next scan respects', async () => {
    await createFirstConnection();
    const ai = mockTrackerAi({ scores: { Sure: 0.9 } });
    const account = await helpers.createAccount({ raw: true });
    const sure = await createExpense({ accountId: account.id, note: 'Sure', time: daysAgo({ days: 10 }) });
    const manual = await createExpense({ accountId: account.id, note: 'Manual', time: daysAgo({ days: 10 }) });
    await createExpense({ accountId: account.id, note: 'Other', time: daysAgo({ days: 10 }) });
    const tracker = await createLisbonTracker();
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [manual.id] }, raw: true });
    await enableSmartTracking({ id: tracker.id });

    await helpers.removeTransactionsFromTracker({
      id: tracker.id,
      payload: { transactionIds: [sure.id, manual.id] },
      raw: true,
    });
    ai.reset();
    await rescan({ id: tracker.id, description: 'Lisbon, again' });

    expect(ai.sentNotes()).toEqual(['Other']);
    const [, rejectedSection = ''] = ai.calls[0]!.prompt.split('REJECTED BY THE USER, NOT IN THIS TRACKER:\n');
    const rejectedRows = rejectedSection.split('\n\nCANDIDATES:')[0]!;
    expect(rejectedRows).toContain('|Sure|');
    expect(rejectedRows).toContain('|Manual|');
    expect(await trackerTransactionCount({ id: tracker.id })).toBe(0);
    expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).aiMatched).toEqual([]);
  });

  describe('date range edits', () => {
    it('rescans newly covered rows when the end date moves later', async () => {
      await createFirstConnection();
      const ai = mockTrackerAi();
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, note: 'Early', time: daysAgo({ days: 15 }) });
      await createExpense({ accountId: account.id, note: 'Late', time: daysAgo({ days: 5 }) });
      const tracker = await createLisbonTracker({ startDays: 30, endDays: 10 });
      await enableSmartTracking({ id: tracker.id });
      expect(ai.sentNotes()).toEqual(['Early']);
      ai.reset();

      const response = await helpers.editTracker({
        id: tracker.id,
        params: { endDate: daysAgo({ days: 1 }) },
        raw: false,
      });
      expect(response.statusCode).toBe(200);
      await helpers.waitForTrackerScanToSettle({ id: tracker.id });

      expect(ai.sentNotes()).toEqual(['Early', 'Late']);
    });

    it('keeps the cursor and queues nothing when a save resends the same days', async () => {
      await createFirstConnection();
      const ai = mockTrackerAi();
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, note: 'Other', time: daysAgo({ days: 15 }) });
      const tracker = await createLisbonTracker({ startDays: 30, endDays: 10 });
      await enableSmartTracking({ id: tracker.id });
      const { lastScannedAt } = (await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).scan;
      ai.reset();

      const response = await helpers.editTracker({
        id: tracker.id,
        params: {
          name: 'Lisbon trip 2026',
          startDate: `${String(tracker.startDate).slice(0, 10)}T00:00:00.000Z`,
          endDate: `${String(tracker.endDate).slice(0, 10)}T23:59:59.999Z`,
        },
        raw: false,
      });

      expect(response.statusCode).toBe(200);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).scan).toMatchObject({
        status: 'idle',
        lastScannedAt,
      });
      expect(await runTrackerSmartScanCron()).toEqual({ due: 1 });
      await helpers.waitForTrackerScanToSettle({ id: tracker.id });
      expect(ai.calls).toEqual([]);
    });
  });

  it('reports a running scan and refuses smart tracking edits until it ends', async () => {
    await createFirstConnection();
    mockTrackerAi({ delayMs: 1500 });
    const account = await helpers.createAccount({ raw: true });
    await createExpense({ accountId: account.id, note: 'Slow', time: daysAgo({ days: 10 }) });
    const tracker = await createLisbonTracker();

    await helpers.editTracker({ id: tracker.id, params: { aiEnabled: true, aiDescription: 'Trip' }, raw: true });

    const { scan } = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
    expect(['queued', 'running']).toContain(scan.status);
    const response = await helpers.editTracker({ id: tracker.id, params: { aiDescription: 'Other' }, raw: false });
    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);

    await helpers.waitForTrackerScanToSettle({ id: tracker.id });
  });

  it('hides suggestions from a share recipient', async () => {
    const tracker = await createLisbonTracker();
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const response = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTrackerSuggestions({ id: tracker.id }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('pauses on a reached AI allowance without calling the model or moving the cursor', async () => {
    enableServerModel();
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '0';
    let modelCalls = 0;
    global.mswMockServer.use(
      http.post(GEMINI_API_URL, () => {
        modelCalls++;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const tracker = await createLisbonTracker();

    await enableSmartTracking({ id: tracker.id });

    expect(modelCalls).toBe(0);
    expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).scan).toMatchObject({
      lastScannedAt: null,
      pausedReason: 'allowance',
    });
  });

  it('stops between batches once the AI allowance runs out, keeping what it found and the cursor', async () => {
    enableServerModel();
    // One mocked call on gemini-3.5-flash-lite (100 in / 50 out tokens) costs $0.000155, past this cap.
    process.env.AI_MONTHLY_CAP_USD_TRIAL = '0.0001';
    const prompts: string[] = [];
    global.mswMockServer.use(
      http.post(GEMINI_API_URL, async ({ request }) => {
        prompts.push(await request.text());
        return HttpResponse.json({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ matches: [{ id: 't1', score: 0.6, reason: 'Fits' }] }) }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
        });
      }),
    );
    const account = await helpers.createAccount({ raw: true });
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        createExpense({ accountId: account.id, note: `Row ${index}`, time: daysAgo({ days: 20 }) }),
      ),
    );
    await createExpense({ accountId: account.id, note: 'Latest', time: daysAgo({ days: 1 }) });
    const tracker = await createLisbonTracker();

    await enableSmartTracking({ id: tracker.id });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('Latest');
    const suggestions = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
    expect(suggestions.pending).toHaveLength(1);
    expect(suggestions.scan).toMatchObject({ lastScannedAt: expect.any(String), pausedReason: 'allowance' });
    const notifications = await helpers.getNotifications({ raw: true });
    expect(notifications.filter((notification) => notification.type === NOTIFICATION_TYPES.trackerAiMatches)).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ linkedCount: 0, suggestedCount: 1 }) }),
    ]);

    delete process.env.AI_MONTHLY_CAP_USD_TRIAL;
    expect(await runTrackerSmartScanCron()).toEqual({ due: 1 });
    await helpers.waitForTrackerScanToSettle({ id: tracker.id });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Latest');
  }, 60_000);

  it('duplicates the description and window but leaves smart tracking off', async () => {
    await createFirstConnection();
    mockTrackerAi();
    const tracker = await createLisbonTracker({ aiPreWindowDays: 90 });
    await enableSmartTracking({ id: tracker.id, description: 'Trip costs' });

    const copy = await helpers.duplicateTracker({ id: tracker.id, raw: true });

    expect(copy).toMatchObject({ aiEnabled: false, aiDescription: 'Trip costs', aiPreWindowDays: 90 });
  });

  it('reports an archived smart tracker as paused', async () => {
    await createFirstConnection();
    mockTrackerAi();
    const tracker = await createLisbonTracker();
    await enableSmartTracking({ id: tracker.id });

    await helpers.archiveTracker({ id: tracker.id, isArchived: true, raw: true });

    expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).scan.pausedReason).toBe('archived');
  });

  it('hides smart tracking settings from a share recipient', async () => {
    await createFirstConnection();
    mockTrackerAi();
    const tracker = await createLisbonTracker();
    await enableSmartTracking({ id: tracker.id, description: 'Private trip notes' });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.read });

    const recipientView = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTrackerById({ id: tracker.id, raw: true }),
    });

    expect(recipientView).toMatchObject({
      aiEnabled: false,
      aiDescription: null,
      aiLastScannedAt: null,
      aiPreWindowDays: TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
    });
  });

  it('hides smart tracking settings from a manage recipient in edit and archive responses', async () => {
    await createFirstConnection();
    mockTrackerAi();
    const tracker = await createLisbonTracker();
    await enableSmartTracking({ id: tracker.id, description: 'Private trip notes' });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const [edited, archived] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => [
        await helpers.editTracker({ id: tracker.id, params: { name: 'Renamed' }, raw: true }),
        await helpers.archiveTracker({ id: tracker.id, isArchived: true, raw: true }),
      ],
    });

    for (const response of [edited, archived]) {
      expect(response).toMatchObject({ aiEnabled: false, aiDescription: null, aiLastScannedAt: null });
    }
    expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({
      aiEnabled: true,
      aiDescription: 'Private trip notes',
    });
  });

  it('keeps earlier batches and the cursor when a later batch fails', async () => {
    await createFirstConnection();
    let calls = 0;
    global.mswMockServer.use(
      getCustomEndpointDynamicMock({
        respond: ({ body }) => {
          const [, table] = userPrompt(body).split('CANDIDATES:\n');
          if (!table) return 'ok';
          calls++;
          if (calls > 1) return 'not json';
          const row = table.split('\n').find((line) => line.split('|')[6] === 'Row 0')!;
          return JSON.stringify({ matches: [{ id: row.split('|')[0], score: 0.6, reason: 'Fits Row 0' }] });
        },
      }),
    );
    const account = await helpers.createAccount({ raw: true });
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        createExpense({ accountId: account.id, note: `Row ${index}`, time: daysAgo({ days: 20 }) }),
      ),
    );
    await createExpense({ accountId: account.id, note: 'Latest', time: daysAgo({ days: 1 }) });
    const tracker = await createLisbonTracker();

    await helpers.editTracker({ id: tracker.id, params: { aiEnabled: true, aiDescription: 'Trip' }, raw: true });
    // The failed job waits for a retry, so the scan never reads as idle here.
    const deadline = Date.now() + 20_000;
    while (!(await matchNotifications()).length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(calls).toBe(2);
    expect(await matchNotifications()).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ linkedCount: 0, suggestedCount: 1 }) }),
    ]);
    const suggestions = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
    expect(suggestions.pending.map((suggestion) => suggestion.transaction.note)).toEqual(['Row 0']);
    expect(suggestions.scan.lastScannedAt).toBeNull();
  }, 60_000);

  it('queues only trackers that are due, from the daily cron', async () => {
    await createFirstConnection();
    mockTrackerAi();
    const due = await createLisbonTracker();
    await enableSmartTracking({ id: due.id });
    const ended = await createLisbonTracker({ startDays: 90, endDays: 30 });
    await enableSmartTracking({ id: ended.id });
    const archived = await createLisbonTracker();
    await enableSmartTracking({ id: archived.id });
    await helpers.archiveTracker({ id: archived.id, isArchived: true, raw: true });
    await createLisbonTracker();

    const result = await runTrackerSmartScanCron();

    expect(result).toEqual({ due: 1 });
    await helpers.waitForTrackerScanToSettle({ id: due.id });
    expect(await runTrackerSmartScanCron({ now: new Date(Date.now() + 40 * DAY_MS) })).toEqual({ due: 0 });
  });
});
