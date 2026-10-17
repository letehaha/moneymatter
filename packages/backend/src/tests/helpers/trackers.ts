import {
  TRACKER_TYPES,
  TrackerModel,
  type EntityLogoWritePayload,
  RESOURCE_TYPES,
  type SharePermission,
  type TrackerSpendingStatsResponse,
  type TrackerAiPreWindowDays,
  type TrackerLineModel,
  type TrackerLinePayload,
  type TrackerSuggestionsResponse,
} from '@bt/shared/types';
import addTransactionsToTrackerController from '@controllers/trackers/add-transactions-to-tracker';
import removeTransactionsFromTrackerController from '@controllers/trackers/remove-transactions-from-tracker';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { serializeTrackerStats } from '@root/serializers';
import * as createTrackerService from '@root/services/trackers/create-tracker';
import * as getTrackersService from '@root/services/trackers/get-trackers';
import { Response } from 'express';

import { downloadBinary } from './attachments';
import { makeRequest } from './common';
import { type SecondUserHandle, acceptShareInvitation, asUser, createShareInvitation } from './share';

interface TestCreateTrackerPayload extends EntityLogoWritePayload {
  id?: string;
  name: string;
  status?: string;
  type?: TRACKER_TYPES;
  categoryIds?: string[];
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  autoInclude?: boolean;
  limitAmount?: number | null;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface EditTrackerPayload extends EntityLogoWritePayload {
  name?: string;
  categoryIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: number | null;
  autoInclude?: boolean;
  archivePromptDismissed?: boolean;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

interface LinkTransactionsToTrackerPayload {
  transactionIds: string[];
}

export async function createTracker<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: TestCreateTrackerPayload & { raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof createTrackerService.createTracker>>, R>({
    method: 'post',
    url: '/trackers',
    payload,
    raw,
  });
}

export async function getTrackers<R extends boolean | undefined = undefined>({
  raw,
  status,
}: {
  raw?: R;
  status?: string;
} = {}) {
  return makeRequest<TrackerModel[], R>({
    method: 'get',
    url: '/trackers',
    payload: status ? { status } : null,
    raw,
  });
}

export async function getTrackerById<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof getTrackersService.getTrackerById>>, R>({
    method: 'get',
    url: `/trackers/${id}`,
    raw,
  });
}

export async function deleteTracker<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<{ success: boolean }, R>({
    method: 'delete',
    url: `/trackers/${id}`,
    raw,
  });
}

export async function editTracker({
  id,
  params,
  raw,
}: {
  id: string;
  params: EditTrackerPayload;
  raw?: false;
}): Promise<Response>;
export async function editTracker({
  id,
  params,
  raw,
}: {
  id: string;
  params: EditTrackerPayload;
  raw?: true;
}): Promise<TrackerModel>;
export async function editTracker({
  id,
  params,
  raw = true,
}: {
  id: string;
  params: EditTrackerPayload;
  raw?: boolean;
}): Promise<Response | TrackerModel> {
  const result = await makeRequest({
    method: 'put',
    url: `/trackers/${id}`,
    payload: params,
    raw,
  });

  return result;
}

export async function addTransactionsToTracker<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: LinkTransactionsToTrackerPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof addTransactionsToTrackerController>> | null, R>({
    method: 'post',
    url: `/trackers/${id}/transactions`,
    payload,
    raw,
  });
}

export async function removeTransactionsFromTracker<R extends boolean | undefined = undefined>({
  id,
  payload,
  raw,
}: {
  id: string;
  payload: LinkTransactionsToTrackerPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof removeTransactionsFromTrackerController>> | null, R>({
    method: 'delete',
    url: `/trackers/${id}/transactions`,
    payload,
    raw,
  });
}

export async function archiveTracker<R extends boolean | undefined = undefined>({
  id,
  isArchived,
  raw,
}: {
  id: string;
  isArchived: boolean;
  raw?: R;
}) {
  return makeRequest<TrackerModel, R>({
    method: 'patch',
    url: `/trackers/${id}/archive`,
    payload: { isArchived },
    raw,
  });
}

export async function duplicateTracker<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<TrackerModel, R>({
    method: 'post',
    url: `/trackers/${id}/duplicate`,
    raw,
  });
}

export async function createTrackerLine<R extends boolean | undefined = undefined>({
  trackerId,
  payload,
  raw,
}: {
  trackerId: string;
  payload: TrackerLinePayload;
  raw?: R;
}) {
  return makeRequest<TrackerLineModel, R>({
    method: 'post',
    url: `/trackers/${trackerId}/lines`,
    payload,
    raw,
  });
}

export async function updateTrackerLine<R extends boolean | undefined = undefined>({
  trackerId,
  lineId,
  payload,
  raw,
}: {
  trackerId: string;
  lineId: string;
  payload: Partial<TrackerLinePayload>;
  raw?: R;
}) {
  return makeRequest<TrackerLineModel, R>({
    method: 'put',
    url: `/trackers/${trackerId}/lines/${lineId}`,
    payload,
    raw,
  });
}

export async function deleteTrackerLine<R extends boolean | undefined = undefined>({
  trackerId,
  lineId,
  raw,
}: {
  trackerId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<Record<string, never>, R>({
    method: 'delete',
    url: `/trackers/${trackerId}/lines/${lineId}`,
    raw,
  });
}

export async function getTrackerStats<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<ReturnType<typeof serializeTrackerStats> | null, R>({
    method: 'get',
    url: `/trackers/${id}/stats`,
    raw,
  });
}

interface CategoryTrackerTransactionsResponse {
  transactions: Array<{
    id: string;
    time: Date;
    transactionType: string;
    refAmount: number;
    amount: number;
    note: string | null;
    categoryId: string | null;
    accountId: string;
    effectiveCategory?: {
      id: string;
      name: string;
      color: string;
    };
    effectiveRefAmount?: number;
  }>;
  total: number;
}

export async function getCategoryTrackerTransactions<R extends boolean | undefined = undefined>({
  id,
  from,
  limit,
  raw,
}: {
  id: string;
  from?: number;
  limit?: number;
  raw?: R;
}) {
  const queryParams = new URLSearchParams();
  if (from !== undefined) queryParams.set('from', String(from));
  if (limit !== undefined) queryParams.set('limit', String(limit));
  const queryString = queryParams.toString();

  return makeRequest<CategoryTrackerTransactionsResponse, R>({
    method: 'get',
    url: `/trackers/${id}/category-transactions${queryString ? `?${queryString}` : ''}`,
    raw,
  });
}

export async function getTrackerSpendingStats<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<TrackerSpendingStatsResponse, R>({
    method: 'get',
    url: `/trackers/${id}/spending-stats`,
    raw,
  });
}

export async function shareTrackerWith({
  trackerId,
  recipient,
  permission,
}: {
  trackerId: string;
  recipient: SecondUserHandle;
  permission: SharePermission;
}) {
  const invitation = await createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.tracker,
    resourceId: trackerId,
    permission,
    raw: true,
  });
  await asUser({ cookies: recipient.cookies, fn: () => acceptShareInvitation({ token: invitation.token, raw: true }) });
}

export async function getLogoImage({ id }: { id: string }) {
  const { statusCode, body, header } = await downloadBinary({ url: `/logo-images/${id}` });
  return {
    statusCode,
    body,
    contentType: header({ name: 'content-type' }),
    cacheControl: header({ name: 'cache-control' }),
  };
}

export async function getTrackerSuggestions<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<TrackerSuggestionsResponse<TransactionApiResponse>, R>({
    method: 'get',
    url: `/trackers/${id}/suggestions`,
    raw,
  });
}

export async function resolveTrackerSuggestions<R extends boolean | undefined = undefined>({
  id,
  action,
  suggestionIds,
  raw,
}: {
  id: string;
  action: 'accept' | 'reject' | 'restore';
  suggestionIds: string[];
  raw?: R;
}) {
  return makeRequest<{ resolvedCount: number }, R>({
    method: 'post',
    url: `/trackers/${id}/suggestions/${action}`,
    payload: { suggestionIds },
    raw,
  });
}

/** The scan runs on a queue with no HTTP trigger, so tests poll the scan status until it is idle. */
export async function waitForTrackerScanToSettle({
  id,
  timeoutMs = 20000,
  pollIntervalMs = 200,
}: {
  id: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const { scan } = await getTrackerSuggestions({ id, raw: true });
    if (scan.status === 'idle') return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Tracker scan did not settle within ${timeoutMs}ms`);
}
