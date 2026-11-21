import { api } from '@/api/_api';
import {
  type EntityLogoWritePayload,
  type ResolveTrackerSuggestionsBody,
  type ResolveTrackerSuggestionsResponse,
  type TrackerAiPreWindowDays,
  type TRACKER_LIMIT_KINDS,
  type TrackerLineModel,
  type TrackerLinePayload,
  TrackerModel,
  type TrackerSpendingStatsResponse,
  type TrackerStatsResponse,
  type TrackerSuggestionsResponse,
  type TrackerSyncResponse,
} from '@bt/shared/types';

interface SmartTrackingPayload {
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface RulesPayload {
  rulesEnabled?: boolean;
  rulesCleanup?: boolean;
  categoryIds?: string[];
  tagIds?: string[];
}

interface EditTrackerPayload extends EntityLogoWritePayload, SmartTrackingPayload, RulesPayload {
  name?: string;
  limitAmount?: number | null;
  limitKind?: TRACKER_LIMIT_KINDS;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  archivePromptDismissed?: boolean;
}

export const loadTrackers = async ({ status }: { status?: string } = {}): Promise<TrackerModel[]> => {
  return api.get('/trackers', status ? { status } : undefined);
};

export const loadTrackerById = async ({ trackerId }: { trackerId: string }): Promise<TrackerModel> => {
  return api.get(`/trackers/${trackerId}`);
};

interface CreateTrackerPayload extends EntityLogoWritePayload, SmartTrackingPayload, RulesPayload {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: number | null;
  limitKind?: TRACKER_LIMIT_KINDS;
}

export const createTracker = async (payload: CreateTrackerPayload): Promise<TrackerModel> =>
  api.post('/trackers', payload);

export const deleteTracker = async ({ trackerId }: { trackerId: string }) => api.delete(`/trackers/${trackerId}`);

export const archiveTracker = async ({ trackerId, isArchived }: { trackerId: string; isArchived: boolean }) =>
  api.patch(`/trackers/${trackerId}/archive`, { isArchived });

export const editTracker = async ({ trackerId, payload }: { trackerId: string; payload: EditTrackerPayload }) => {
  await api.put(`/trackers/${trackerId}`, payload);
};

export const duplicateTracker = async ({ trackerId }: { trackerId: string }): Promise<TrackerModel> =>
  api.post(`/trackers/${trackerId}/duplicate`);

export const addTransactionsToTracker = async ({
  trackerId,
  payload,
}: {
  trackerId: string;
  payload: Record<string, unknown>;
}) => api.post(`/trackers/${trackerId}/transactions`, payload);

export const removeTransactionsFromTracker = async ({
  trackerId,
  payload,
}: {
  trackerId: string;
  payload: { transactionIds: string[] };
}) => api.delete(`/trackers/${trackerId}/transactions`, { data: payload });

export const createTrackerLine = async ({
  trackerId,
  payload,
}: {
  trackerId: string;
  payload: TrackerLinePayload;
}): Promise<TrackerLineModel> => api.post(`/trackers/${trackerId}/lines`, payload);

export const updateTrackerLine = async ({
  trackerId,
  lineId,
  payload,
}: {
  trackerId: string;
  lineId: string;
  payload: Partial<TrackerLinePayload>;
}): Promise<TrackerLineModel> => api.put(`/trackers/${trackerId}/lines/${lineId}`, payload);

export const deleteTrackerLine = async ({ trackerId, lineId }: { trackerId: string; lineId: string }) =>
  api.delete(`/trackers/${trackerId}/lines/${lineId}`);

export const loadTrackerStats = async ({ trackerId }: { trackerId: string }): Promise<TrackerStatsResponse> => {
  return api.get(`/trackers/${trackerId}/stats`);
};

export const syncTrackerRules = async ({ trackerId }: { trackerId: string }): Promise<TrackerSyncResponse> =>
  api.post(`/trackers/${trackerId}/sync`, undefined, { silent: true });

export const loadTrackerSpendingStats = async ({
  trackerId,
}: {
  trackerId: string;
}): Promise<TrackerSpendingStatsResponse> => {
  return api.get(`/trackers/${trackerId}/spending-stats`);
};

export const loadTrackerSuggestions = async ({
  trackerId,
}: {
  trackerId: string;
}): Promise<TrackerSuggestionsResponse> => api.get(`/trackers/${trackerId}/suggestions`);

export const acceptTrackerSuggestions = async ({
  trackerId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { trackerId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/trackers/${trackerId}/suggestions/accept`, { suggestionIds });

export const rejectTrackerSuggestions = async ({
  trackerId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { trackerId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/trackers/${trackerId}/suggestions/reject`, { suggestionIds });

export const restoreTrackerSuggestions = async ({
  trackerId,
  suggestionIds,
}: ResolveTrackerSuggestionsBody & { trackerId: string }): Promise<ResolveTrackerSuggestionsResponse> =>
  api.post(`/trackers/${trackerId}/suggestions/restore`, { suggestionIds });
