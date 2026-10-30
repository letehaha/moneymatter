import type { NonImageLogoPayload } from '@bt/shared/types';
import { VENTURE_DEAL_STATUS } from '@bt/shared/types/venture';
import { removeUndefinedKeys } from '@js/helpers';
import { createVentureDeal as _createVentureDeal } from '@services/venture/deals/create.service';
import { deleteVentureDeal as _deleteVentureDeal } from '@services/venture/deals/delete.service';
import { getVentureDeal as _getVentureDeal } from '@services/venture/deals/get.service';
import { listVentureDeals as _listVentureDeals } from '@services/venture/deals/list.service';
import { updateVentureDeal as _updateVentureDeal } from '@services/venture/deals/update.service';

import { makeRequest } from '../common';

export function buildVentureDealPayload(
  overrides: Partial<Omit<Parameters<typeof _createVentureDeal>[0], 'userId'>> = {},
): Omit<Parameters<typeof _createVentureDeal>[0], 'userId'> {
  return {
    name: 'SK 116 — Founder Factor YC W26',
    currencyCode: 'USD',
    principal: '16000',
    investmentDate: '2026-03-24',
    entryFeePct: '0.085',
    carryPct: '0.2',
    hurdlePct: '0',
    mgmtFeePct: '0',
    ...overrides,
  };
}

export async function createVentureDeal<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload?: Partial<ReturnType<typeof buildVentureDealPayload>>;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof _createVentureDeal>>, R>({
    method: 'post',
    url: '/venture/deals',
    payload: buildVentureDealPayload(payload),
    raw,
  });
}

export async function listVentureDeals<R extends boolean | undefined = false>({
  status,
  platformId,
  limit,
  offset,
  raw,
}: {
  status?: VENTURE_DEAL_STATUS;
  platformId?: string;
  limit?: number;
  offset?: number;
  raw?: R;
} = {}) {
  return makeRequest<
    {
      data: Awaited<ReturnType<typeof _listVentureDeals>>;
      pagination: { limit: number; offset: number; page: number };
    },
    R
  >({
    method: 'get',
    url: '/venture/deals',
    payload: removeUndefinedKeys({ status, platformId, limit, offset }),
    raw,
  });
}

export async function getVentureDeal<R extends boolean | undefined = false>({
  dealId,
  includeEvents,
  raw,
}: {
  dealId: string;
  includeEvents?: boolean;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getVentureDeal>>, R>({
    method: 'get',
    url: `/venture/deals/${dealId}`,
    payload: removeUndefinedKeys({ includeEvents }),
    raw,
  });
}

export async function updateVentureDeal<R extends boolean | undefined = false>({
  dealId,
  payload,
  raw,
}: {
  dealId: string;
  payload: Partial<ReturnType<typeof buildVentureDealPayload>> &
    NonImageLogoPayload & {
      status?: VENTURE_DEAL_STATUS;
    };
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updateVentureDeal>>, R>({
    method: 'put',
    url: `/venture/deals/${dealId}`,
    payload,
    raw,
  });
}

export async function getVentureDealMetrics<R extends boolean | undefined = false>({
  dealId,
  raw,
}: {
  dealId: string;
  raw?: R;
}) {
  return makeRequest<
    {
      costBasis: string;
      totalInvested: string;
      currentValue: string;
      totalDistributions: string;
      pnlAbsolute: string;
      pnlPct: string | null;
      tvpi: string | null;
      dpi: string | null;
      irr: string | null;
    },
    R
  >({
    method: 'get',
    url: `/venture/deals/${dealId}/metrics`,
    raw,
  });
}

export async function deleteVentureDeal<R extends boolean | undefined = false>({
  dealId,
  force,
  raw,
}: {
  dealId: string;
  force?: boolean;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _deleteVentureDeal>>, R>({
    method: 'delete',
    url: `/venture/deals/${dealId}`,
    payload: removeUndefinedKeys({ force }),
    raw,
  });
}
