import { getAiCategorizationStatus } from '@/api/ai-categorization';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import type { AiCategorizationStatus } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { type AiCategorizationProgressPayload, SSE_EVENT_TYPES, useSSE } from './use-sse';

// Global state shared across all component instances
const categorizationStatus = ref<AiCategorizationProgressPayload | null>(null);
const justCompleted = ref(false);

const TERMINAL_STATUS_DISPLAY_MS = 5000;

// Bumped by reset() so a snapshot fetched under a previous login can never apply
// after logout. `categorizationStatus` alone cannot tell: an idle tab and a reset
// tab both hold `null`.
let sessionEpoch = 0;

let hasSnapshotThisSession = false;

// SSE subscription state
let sseUnsubscribe: (() => void) | null = null;
let isSSESubscribed = false;

const isRunOver = (status: AiCategorizationProgressPayload['status'] | undefined) =>
  status === 'completed' || status === 'failed';

/**
 * Composable for tracking AI categorization progress.
 *
 * Subscribes to SSE events for real-time progress updates during
 * AI categorization of imported transactions.
 */
export function useCategorizationStatus() {
  const { connect, on, isConnected } = useSSE();
  const { addNotification } = useNotificationCenter();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const isCategorizing = computed(() => {
    if (!categorizationStatus.value) return false;
    return categorizationStatus.value.status === 'queued' || categorizationStatus.value.status === 'processing';
  });

  const progress = computed(() => {
    if (!categorizationStatus.value || categorizationStatus.value.totalCount === 0) {
      return 0;
    }
    return Math.round((categorizationStatus.value.processedCount / categorizationStatus.value.totalCount) * 100);
  });

  const showSuccessMessage = computed(() => {
    return justCompleted.value && !isCategorizing.value;
  });

  const finishRun = ({
    status,
    processedCount,
    failedCount,
    skippedCount,
    errorMessage,
  }: {
    status: 'completed' | 'failed';
    processedCount: number;
    failedCount: number;
    skippedCount: number;
    errorMessage?: string;
  }) => {
    justCompleted.value = true;

    queryClient.invalidateQueries({
      queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
    });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.aiFeaturesStatus });

    const categorizedCount = processedCount - failedCount - skippedCount;
    if (status === 'completed' && categorizedCount > 0) {
      addNotification({
        text:
          skippedCount > 0
            ? t('header.categorization.completedWithSkipped', { count: categorizedCount, skipped: skippedCount })
            : t('header.categorization.completed', { count: categorizedCount }),
        type: NotificationType.success,
      });
    } else if (status === 'failed' || failedCount > 0) {
      // A run whose every transaction failed still ends as `completed`, so without
      // the failedCount check it would end in silence.
      addNotification({
        text: errorMessage ?? t('header.categorization.failed'),
        type: NotificationType.error,
      });
    } else if (status === 'completed' && skippedCount > 0) {
      // Nothing failed and nothing was categorized: the AI reviewed every row and
      // declined them all, which deserves an explanation rather than silence.
      addNotification({
        text: t('header.categorization.allSkipped', { count: skippedCount }),
        type: NotificationType.info,
      });
    }

    setTimeout(() => {
      justCompleted.value = false;
      // A run that started inside the display window owns the indicator now.
      if (isRunOver(categorizationStatus.value?.status)) {
        categorizationStatus.value = null;
      }
    }, TERMINAL_STATUS_DISPLAY_MS);
  };

  /**
   * Subscribe to SSE categorization progress events
   */
  const subscribeToSSE = async () => {
    if (isSSESubscribed) return;

    // Connect to SSE first
    await connect();

    sseUnsubscribe = on(SSE_EVENT_TYPES.AI_CATEGORIZATION_PROGRESS, (data) => {
      // The ending is read off the event, never off what this tab saw earlier: a
      // tab opened mid-run holds no prior status. The prior status only guards
      // against handling the same ending twice.
      const alreadyHandled = isRunOver(categorizationStatus.value?.status);

      categorizationStatus.value = data;

      if (!alreadyHandled && (data.status === 'completed' || data.status === 'failed')) {
        finishRun({
          status: data.status,
          processedCount: data.processedCount,
          failedCount: data.failedCount,
          skippedCount: data.skippedCount ?? 0,
          errorMessage: data.errorMessage,
        });
      }
    });

    isSSESubscribed = true;
  };

  /**
   * Re-sync from the status endpoint. SSE only delivers events while the tab is
   * open and connected, so a reload during a run, or a drop across its end, would
   * otherwise leave the header wrong until the next login.
   */
  const hydrateFromServer = async () => {
    const before = categorizationStatus.value;
    const epoch = sessionEpoch;
    const isFirstSnapshot = !hasSnapshotThisSession;

    let status: AiCategorizationStatus;
    try {
      status = await getAiCategorizationStatus();
    } catch (error) {
      // Best-effort: SSE remains the live channel when the snapshot fetch fails.
      console.error('[AI Categorization] Status snapshot fetch failed:', error);
      return;
    }

    // A reset() during the fetch means this snapshot belongs to a previous login.
    if (epoch !== sessionEpoch) return;
    // A live SSE event that landed during the fetch is fresher than this snapshot.
    if (categorizationStatus.value !== before) return;

    hasSnapshotThisSession = true;

    switch (status.status) {
      case 'queued':
      case 'processing':
        categorizationStatus.value = status;
        return;

      // The server hands a terminal outcome to the first client that asks and then
      // settles back to `idle`, so this snapshot is the only chance to show an
      // ending whose SSE event never arrived.
      case 'completed':
      case 'failed':
        categorizationStatus.value = status;
        finishRun({
          status: status.status,
          processedCount: status.processedCount,
          failedCount: status.failedCount,
          skippedCount: status.skippedCount ?? 0,
          errorMessage: status.errorMessage,
        });
        return;

      case 'idle': {
        const wasRunning = before?.status === 'queued' || before?.status === 'processing';
        if (wasRunning) categorizationStatus.value = null;

        // `idle` carries no counts, but a run that just ended still rewrote categories the
        // open queries now hold stale. The session's first snapshot counts too: it lands
        // after those queries resolved, so they can hold pre-categorization data.
        if (wasRunning || isFirstSnapshot) {
          queryClient.invalidateQueries({
            queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange],
          });
        }
        return;
      }

      default:
        return status satisfies never;
    }
  };

  /**
   * Unsubscribe from SSE categorization progress events
   */
  const unsubscribeFromSSE = () => {
    if (sseUnsubscribe) {
      sseUnsubscribe();
      sseUnsubscribe = null;
    }
    isSSESubscribed = false;
  };

  /**
   * Reset categorization status
   */
  const reset = () => {
    sessionEpoch += 1;
    hasSnapshotThisSession = false;
    categorizationStatus.value = null;
    justCompleted.value = false;
  };

  return {
    // State
    categorizationStatus,
    isCategorizing,
    progress,
    justCompleted,
    showSuccessMessage,
    isConnected,

    // Methods
    subscribeToSSE,
    unsubscribeFromSSE,
    hydrateFromServer,
    reset,
  };
}
