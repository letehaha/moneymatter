import { api } from '@/api/_api';
import type {
  TransactionVentureLink,
  VENTURE_CASH_FLOW_MODE,
  VENTURE_EVENT_TYPE,
  VentureEventModel,
} from '@bt/shared/types';

interface CreateEventPayload {
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

export const listVentureEvents = async (params: { dealId: string }): Promise<VentureEventModel[]> => {
  return api.get(`/venture/deals/${params.dealId}/events`);
};

export const createVentureEvent = async (params: {
  dealId: string;
  payload: CreateEventPayload;
}): Promise<VentureEventModel> => {
  return api.post(`/venture/deals/${params.dealId}/events`, params.payload);
};

export const deleteVentureEvent = async (params: {
  eventId: string;
  deleteLinkedTransactions?: boolean;
}): Promise<{ success: boolean; recomputedEventIds: string[] }> => {
  const query: Record<string, string> = {};
  if (params.deleteLinkedTransactions !== undefined) {
    query.deleteLinkedTransactions = String(params.deleteLinkedTransactions);
  }
  return api.delete(`/venture/events/${params.eventId}`, { query });
};

export const getTransactionVentureLink = async (params: { transactionId: string }): Promise<TransactionVentureLink> => {
  return api.get(`/transactions/${params.transactionId}/venture-link`);
};
