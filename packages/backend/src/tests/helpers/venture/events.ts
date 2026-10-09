import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { removeUndefinedKeys } from '@js/helpers';
import { createVentureEvent as _createVentureEvent } from '@services/venture/events/create.service';
import { deleteVentureEvent as _deleteVentureEvent } from '@services/venture/events/delete.service';
import { getVentureEvent as _getVentureEvent } from '@services/venture/events/get.service';
import { listVentureEvents as _listVentureEvents } from '@services/venture/events/list.service';
import { updateVentureEvent as _updateVentureEvent } from '@services/venture/events/update.service';
import { getTransactionVentureLink as _getTransactionVentureLink } from '@services/venture/linking/get-transaction-venture-link.service';

import { makeRequest } from '../common';

interface CreateVentureEventPayload {
  type: VENTURE_EVENT_TYPE;
  eventDate: string;
  cashFlowMode: VENTURE_CASH_FLOW_MODE;
  grossAmount?: string | null;
  navAfter?: string | null;
  quantityPct?: string | null;
  transactionIds?: string[];
  lpNetAmountOverride?: string | null;
  gpCarryOverride?: string | null;
  notes?: string | null;
}

export async function createVentureEvent<R extends boolean | undefined = false>({
  dealId,
  payload,
  raw,
}: {
  dealId: string;
  payload: CreateVentureEventPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _createVentureEvent>>, R>({
    method: 'post',
    url: `/venture/deals/${dealId}/events`,
    payload,
    raw,
  });
}

export async function listVentureEvents<R extends boolean | undefined = false>({
  dealId,
  raw,
}: {
  dealId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _listVentureEvents>>, R>({
    method: 'get',
    url: `/venture/deals/${dealId}/events`,
    raw,
  });
}

export async function getVentureEvent<R extends boolean | undefined = false>({
  eventId,
  raw,
}: {
  eventId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getVentureEvent>>, R>({
    method: 'get',
    url: `/venture/events/${eventId}`,
    raw,
  });
}

export async function updateVentureEvent<R extends boolean | undefined = false>({
  eventId,
  payload,
  raw,
}: {
  eventId: string;
  payload: Partial<{
    eventDate: string;
    grossAmount: string | null;
    navAfter: string | null;
    quantityPct: string | null;
    notes: string | null;
    gpCarryAmount: string | null;
    lpNetAmount: string | null;
    resetOverrides: boolean;
  }>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updateVentureEvent>>, R>({
    method: 'put',
    url: `/venture/events/${eventId}`,
    payload,
    raw,
  });
}

export async function deleteVentureEvent<R extends boolean | undefined = false>({
  eventId,
  deleteLinkedTransactions,
  raw,
}: {
  eventId: string;
  deleteLinkedTransactions?: boolean;
  raw?: R;
}) {
  const params = removeUndefinedKeys({ deleteLinkedTransactions });
  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    queryParams[key] = String(value);
  }
  const queryString = Object.keys(queryParams).length ? `?${new URLSearchParams(queryParams)}` : '';
  return makeRequest<Awaited<ReturnType<typeof _deleteVentureEvent>>, R>({
    method: 'delete',
    url: `/venture/events/${eventId}${queryString}`,
    raw,
  });
}

export async function appendEventLinks<R extends boolean | undefined = false>({
  eventId,
  transactionIds,
  raw,
}: {
  eventId: string;
  transactionIds: string[];
  raw?: R;
}) {
  return makeRequest<unknown[], R>({
    method: 'post',
    url: `/venture/events/${eventId}/links`,
    payload: { transactionIds },
    raw,
  });
}

export async function replaceEventLinks<R extends boolean | undefined = false>({
  eventId,
  transactionIds,
  raw,
}: {
  eventId: string;
  transactionIds: string[];
  raw?: R;
}) {
  return makeRequest<unknown[], R>({
    method: 'put',
    url: `/venture/events/${eventId}/links`,
    payload: { transactionIds },
    raw,
  });
}

export async function deleteEventLink<R extends boolean | undefined = false>({
  eventId,
  linkId,
  raw,
}: {
  eventId: string;
  linkId: string;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'delete',
    url: `/venture/events/${eventId}/links/${linkId}`,
    raw,
  });
}

export async function getTransactionVentureLink<R extends boolean | undefined = false>({
  transactionId,
  raw,
}: {
  transactionId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getTransactionVentureLink>>, R>({
    method: 'get',
    url: `/transactions/${transactionId}/venture-link`,
    raw,
  });
}
