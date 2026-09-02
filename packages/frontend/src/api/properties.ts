import { api } from '@/api/_api';
import { balanceAdjustment as adjustAccountBalance } from '@/api/accounts';
import type { AccountModel, PROPERTY_TYPE, RecordId, TransactionModel } from '@bt/shared/types';

export interface PropertyModel {
  id: RecordId;
  accountId: RecordId;
  userId: number;
  /** Linked mortgage account, when the property is financed. */
  loanAccountId: RecordId | null;
  address: string;
  city: string | null;
  country: string | null;
  propertyType: PROPERTY_TYPE;
  yearBuilt: number | null;
  notes: string | null;
  /** Decimal amount in the property's currency. */
  purchasePrice: number;
  purchaseDate: string;
  /** Decimal amount; set on manual revaluation. */
  valueAnchor: number | null;
  valueAnchorDate: string | null;
  /** Signed percent per year. Negative models a declining market. */
  annualAppreciationRatePct: number;
  valueLastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
  account: AccountModel | null;
  loanAccount: AccountModel | null;
}

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

export const getProperties = async (): Promise<PropertyModel[]> => {
  return api.get('/properties');
};

export const getPropertyById = async ({ id }: { id: string }): Promise<PropertyModel> => {
  return api.get(`/properties/${id}`);
};

export const createProperty = async (payload: CreatePropertyPayload): Promise<PropertyModel> => {
  return api.post('/properties', payload);
};

export const updateProperty = async ({
  id,
  payload,
}: {
  id: string;
  payload: UpdatePropertyPayload;
}): Promise<PropertyModel> => {
  return api.patch(`/properties/${id}`, payload);
};

export const deleteProperty = async ({ id }: { id: string }) => {
  return api.delete(`/properties/${id}`);
};

/**
 * Manual revaluation. This is the ONLY sanctioned way to move a property
 * account's balance — the generic `POST /accounts/:id/balance-adjustment` path
 * is rejected server-side because it would leave `valueAnchor` stale.
 */
export const overridePropertyValue = async ({
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
}): Promise<{
  property: PropertyModel | null;
  transaction: TransactionModel | null;
  previousBalance: number;
  newBalance: number;
}> => {
  const adjustment = await adjustAccountBalance({ id: accountId, targetBalance: targetValue, note, time });
  const property = await getPropertyById({ id });

  return { ...adjustment, property };
};
