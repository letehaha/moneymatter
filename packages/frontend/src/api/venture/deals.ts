import { api } from '@/api/_api';
import type {
  NonImageLogoPayload,
  VENTURE_DEAL_STATUS,
  VENTURE_SPV_SUBTYPE,
  VENTURE_VEHICLE_TYPE,
  VentureDealModel,
} from '@bt/shared/types';

interface CreateVentureDealPayload {
  name: string;
  currencyCode: string;
  principal: string;
  investmentDate: string;
  platformId?: string | null;
  vehicleType?: VENTURE_VEHICLE_TYPE;
  spvSubtype?: VENTURE_SPV_SUBTYPE | null;
  targetCompany?: string | null;
  entryFeePct?: string;
  entryFee?: string;
  mgmtFeePct?: string;
  carryPct?: string;
  hurdlePct?: string;
  expectedExitDate?: string | null;
  notes?: string | null;
}

type UpdateVentureDealPayload = Partial<CreateVentureDealPayload> &
  NonImageLogoPayload & {
    status?: VENTURE_DEAL_STATUS;
  };

interface VentureDealsListResponse {
  data: VentureDealModel[];
  pagination: { limit: number; offset: number; page: number };
}

export const createVentureDeal = async (payload: CreateVentureDealPayload): Promise<VentureDealModel> => {
  return api.post('/venture/deals', payload);
};

export const listVentureDeals = async (
  params: { status?: VENTURE_DEAL_STATUS; platformId?: string; limit?: number; offset?: number; page?: number } = {},
): Promise<VentureDealsListResponse> => {
  return api.get('/venture/deals', params);
};

export const getVentureDeal = async (params: {
  dealId: string;
  includeEvents?: boolean;
}): Promise<VentureDealModel> => {
  return api.get(`/venture/deals/${params.dealId}`, params.includeEvents ? { includeEvents: true } : {});
};

export const updateVentureDeal = async (params: {
  dealId: string;
  payload: UpdateVentureDealPayload;
}): Promise<VentureDealModel> => {
  return api.put(`/venture/deals/${params.dealId}`, params.payload);
};

export const deleteVentureDeal = async (params: { dealId: string; force?: boolean }): Promise<void> => {
  return api.delete(`/venture/deals/${params.dealId}`, { data: { force: params.force } });
};
