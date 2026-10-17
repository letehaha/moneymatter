import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAiCategorizationStatus = vi.fn();
const invalidateQueries = vi.fn();
const addNotification = vi.fn();

// Captures the handler `subscribeToSSE` registers, so a test can play a live event.
const sse = vi.hoisted(() => ({ handlers: [] as Array<(data: unknown) => void> }));

vi.mock('@/api/ai-categorization', () => ({
  getAiCategorizationStatus: (...args: unknown[]) => getAiCategorizationStatus(...args),
}));

vi.mock('./use-sse', () => ({
  SSE_EVENT_TYPES: { AI_CATEGORIZATION_PROGRESS: 'ai_categorization_progress' },
  useSSE: () => ({
    connect: vi.fn(),
    on: vi.fn((_event: string, handler: (data: unknown) => void) => {
      sse.handlers.push(handler);
      return () => {};
    }),
    isConnected: { value: true },
  }),
}));

vi.mock('@/common/const', () => ({
  VUE_QUERY_CACHE_KEYS: { aiFeaturesStatus: ['ai-settings', 'features'] },
  VUE_QUERY_GLOBAL_PREFIXES: { transactionChange: 'transactionChange' },
}));

vi.mock('@/components/notification-center', () => ({
  NotificationType: { success: 'success', error: 'error', info: 'info' },
  useNotificationCenter: () => ({ addNotification }),
}));

vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { useCategorizationStatus } from './use-categorization-status';

describe('useCategorizationStatus.hydrateFromServer', () => {
  beforeEach(() => {
    // Module-level shared state persists between tests, so start each one clean.
    useCategorizationStatus().reset();
    vi.clearAllMocks();
  });

  it('restores an in-flight processing run', async () => {
    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'processing',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 2,
    });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toEqual({
      status: 'processing',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 2,
    });
    expect(composable.isCategorizing.value).toBe(true);
  });

  it('restores a queued run', async () => {
    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'queued',
      processedCount: 0,
      totalCount: 10,
      failedCount: 0,
    });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value?.status).toBe('queued');
  });

  it('shows nothing but refetches on the first snapshot of a session (idle response)', async () => {
    // The first snapshot lands after the page's queries resolved, so a run that
    // ended in that window left them stale.
    getAiCategorizationStatus.mockResolvedValueOnce({ status: 'idle' });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toBeNull();
    expect(addNotification).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
  });

  it('stops refetching on later idle snapshots of the same session', async () => {
    getAiCategorizationStatus.mockResolvedValueOnce({ status: 'idle' }).mockResolvedValueOnce({ status: 'idle' });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();
    invalidateQueries.mockClear();

    // A reconnect on a tab that has been idle throughout: nothing can have changed.
    await composable.hydrateFromServer();

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('reports a failed run to a tab that never saw it start', async () => {
    // The server hands a failure to the first client that asks and then forgets it,
    // so a reloaded tab has to consume it.
    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'failed',
      processedCount: 0,
      totalCount: 5,
      failedCount: 5,
      errorMessage: 'Your custom AI endpoint did not respond.',
    });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value?.status).toBe('failed');
    expect(composable.justCompleted.value).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
    expect(addNotification).toHaveBeenCalledWith({
      text: 'Your custom AI endpoint did not respond.',
      type: 'error',
    });
  });

  it('reports a completed run to a tab that reloaded before the terminal event', async () => {
    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'completed',
      processedCount: 8,
      totalCount: 8,
      failedCount: 2,
    });

    const composable = useCategorizationStatus();
    await composable.hydrateFromServer();

    expect(composable.justCompleted.value).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.completed', type: 'success' });
  });

  it('keeps a status a live SSE event delivered while the fetch was in flight', async () => {
    const composable = useCategorizationStatus();
    const liveStatus = {
      status: 'processing' as const,
      processedCount: 1000,
      totalCount: 1500,
      failedCount: 0,
    };

    getAiCategorizationStatus.mockImplementationOnce(async () => {
      // An SSE event lands while the snapshot request is in flight, so the snapshot
      // the server built is already stale and must lose.
      composable.categorizationStatus.value = liveStatus;
      return { status: 'processing', processedCount: 500, totalCount: 1500, failedCount: 0 };
    });
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toEqual(liveStatus);
  });

  it('refreshes an already-shown run with the newer server counts', async () => {
    const composable = useCategorizationStatus();
    composable.categorizationStatus.value = {
      status: 'processing',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 0,
    };

    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'processing',
      processedCount: 1000,
      totalCount: 1500,
      failedCount: 3,
    });
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toEqual({
      status: 'processing',
      processedCount: 1000,
      totalCount: 1500,
      failedCount: 3,
    });
  });

  it('clears a stale run and refetches data when the server reports idle', async () => {
    const composable = useCategorizationStatus();
    composable.categorizationStatus.value = {
      status: 'processing',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 0,
    };

    // The run ended while this tab was disconnected, so its terminal SSE event is
    // gone and only the snapshot can clear the indicator.
    getAiCategorizationStatus.mockResolvedValueOnce({ status: 'idle' });
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toBeNull();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('refetches and shows the failure toast when the server reports failed', async () => {
    const composable = useCategorizationStatus();
    composable.categorizationStatus.value = {
      status: 'processing',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 0,
    };

    // The failure arrived while this tab was disconnected, so the snapshot has to
    // deliver the same error toast the live path would have shown.
    getAiCategorizationStatus.mockResolvedValueOnce({
      status: 'failed',
      processedCount: 500,
      totalCount: 1500,
      failedCount: 1000,
    });
    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value?.status).toBe('failed');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.failed', type: 'error' });
  });

  it('discards a snapshot that resolves after reset() — logout while the fetch is in flight', async () => {
    const composable = useCategorizationStatus();
    getAiCategorizationStatus.mockImplementationOnce(async () => {
      // Logout lands while the snapshot request is still in flight; both sides
      // hold `null`, so only the session epoch can tell the snapshot is stale.
      composable.reset();
      return { status: 'processing', processedCount: 5, totalCount: 10, failedCount: 0 };
    });

    await composable.hydrateFromServer();

    expect(composable.categorizationStatus.value).toBeNull();
  });

  it('logs and swallows fetch errors, leaving the status empty', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getAiCategorizationStatus.mockRejectedValueOnce(new Error('network down'));

    const composable = useCategorizationStatus();
    await expect(composable.hydrateFromServer()).resolves.toBeUndefined();

    expect(composable.categorizationStatus.value).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe('useCategorizationStatus live SSE completion', () => {
  beforeEach(() => {
    const composable = useCategorizationStatus();
    // Module-level shared state persists between tests, so start each one clean and
    // unsubscribe so every test's subscribeToSSE registers a fresh handler.
    composable.unsubscribeFromSSE();
    composable.reset();
    sse.handlers.length = 0;
    vi.clearAllMocks();
  });

  async function subscribe() {
    const composable = useCategorizationStatus();
    await composable.subscribeToSSE();
    return { composable, deliver: sse.handlers.at(-1)! };
  }

  async function subscribeMidRun() {
    const subscription = await subscribe();
    subscription.deliver({ status: 'processing', processedCount: 0, totalCount: 10, failedCount: 0 });
    return subscription;
  }

  it('toasts the run-level reason when a run completes with nothing categorized', async () => {
    const { deliver } = await subscribeMidRun();

    // A run whose provider died mid-way still ends as `completed`, and the payload's
    // errorMessage is the only trace of why.
    deliver({
      status: 'completed',
      processedCount: 10,
      totalCount: 10,
      failedCount: 10,
      errorMessage: 'Your custom AI endpoint did not respond.',
    });

    expect(addNotification).toHaveBeenCalledWith({
      text: 'Your custom AI endpoint did not respond.',
      type: 'error',
    });
  });

  it('falls back to the generic failure text when the payload carries no reason', async () => {
    const { deliver } = await subscribeMidRun();

    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 10 });

    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.failed', type: 'error' });
  });

  it('keeps the success toast when at least one transaction was categorized', async () => {
    const { deliver } = await subscribeMidRun();

    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 4 });

    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.completed', type: 'success' });
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it('mentions the skips alongside the success when the AI declined part of the run', async () => {
    const { deliver } = await subscribeMidRun();

    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 0, skippedCount: 3 });

    expect(addNotification).toHaveBeenCalledWith({
      text: 'header.categorization.completedWithSkipped',
      type: 'success',
    });
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it('explains an all-skipped run with an info toast instead of failure or silence', async () => {
    const { deliver } = await subscribeMidRun();

    // The model reviewed every row and declined them all (e.g. they are all
    // transfers): nothing failed, so an error toast would be a lie.
    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 0, skippedCount: 10 });

    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.allSkipped', type: 'info' });
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it('handles the ending on a tab that opened after the run started', async () => {
    // A tab that connects mid-run holds no prior status, so the outcome has to be
    // read off the event itself or the header stays pinned on a finished run.
    const { composable, deliver } = await subscribe();

    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 0 });

    expect(composable.justCompleted.value).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['transactionChange'] });
    expect(addNotification).toHaveBeenCalledWith({ text: 'header.categorization.completed', type: 'success' });
  });

  it('handles a run ending only once when the server repeats the terminal event', async () => {
    const { deliver } = await subscribeMidRun();

    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 0 });
    deliver({ status: 'completed', processedCount: 10, totalCount: 10, failedCount: 0 });

    expect(addNotification).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-settings', 'features'] });
  });
});
