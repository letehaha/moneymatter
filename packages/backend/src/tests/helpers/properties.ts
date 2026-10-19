import { asDecimal, PROPERTY_TYPE } from '@bt/shared/types';
import type { PropertyApiResponse } from '@root/serializers/properties.serializer';

import { balanceAdjustment } from './account';
import { extractResponse, makeRequest } from './common';

interface CreatePropertyPayload {
  name: string;
  currencyCode: string;
  address: string;
  city?: string | null;
  country?: string | null;
  propertyType: PROPERTY_TYPE;
  yearBuilt?: number | null;
  notes?: string | null;
  purchasePrice: number;
  purchaseDate: string;
  annualAppreciationRatePct?: number;
  loanAccountId?: string | null;
}

interface UpdatePropertyPayload {
  name?: string;
  address?: string;
  city?: string | null;
  country?: string | null;
  propertyType?: PROPERTY_TYPE;
  yearBuilt?: number | null;
  notes?: string | null;
  annualAppreciationRatePct?: number;
  loanAccountId?: string | null;
}

export async function createProperty<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: CreatePropertyPayload & { raw?: R }) {
  return makeRequest<PropertyApiResponse, R>({
    method: 'post',
    url: '/properties',
    payload,
    raw,
  });
}

export async function getProperties<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<PropertyApiResponse[], R>({
    method: 'get',
    url: '/properties',
    raw,
  });
}

export async function getPropertyById<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<PropertyApiResponse, R>({
    method: 'get',
    url: `/properties/${id}`,
    raw,
  });
}

export async function updateProperty<R extends boolean | undefined = undefined>({
  id,
  raw,
  ...payload
}: UpdatePropertyPayload & { id: string; raw?: R }) {
  return makeRequest<PropertyApiResponse, R>({
    method: 'patch',
    url: `/properties/${id}`,
    payload,
    raw,
  });
}

/** Property value override = balance adjustment on the properties account. */
export async function overridePropertyValue({
  id,
  accountId,
  targetValue,
  note,
  time,
}: {
  id: string;
  accountId: string;
  targetValue: number;
  note?: string;
  time?: Date;
}) {
  const adjustment = await balanceAdjustment({
    id: accountId,
    payload: { targetBalance: asDecimal(targetValue), note, time: time?.toISOString() },
    raw: false,
  });
  const property = await getPropertyById({ id, raw: true });
  return { ...extractResponse(adjustment), statusCode: adjustment.statusCode, property };
}

export async function deleteProperty<R extends boolean | undefined = undefined>({ id, raw }: { id: string; raw?: R }) {
  return makeRequest<{ id: string }, R>({
    method: 'delete',
    url: `/properties/${id}`,
    raw,
  });
}
