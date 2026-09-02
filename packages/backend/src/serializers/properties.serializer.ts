/**
 * Property Serializers
 *
 * Property responses include the underlying Account inline so the frontend has
 * one round-trip to render a property card / detail (name, currency, current
 * value all come from Accounts; metadata + the appreciation rate come from
 * Properties). The linked mortgage's balance rides along too, so the detail
 * page can show equity without a second request.
 */
import { PROPERTY_TYPE, type RecordId } from '@bt/shared/types';
import { centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import type Properties from '@models/properties.model';
import { serializeAccount, type AccountApiResponse } from '@root/serializers/accounts.serializer';

export interface PropertyApiResponse {
  id: string;
  accountId: RecordId;
  userId: number;
  loanAccountId: RecordId | null;
  address: string;
  city: string | null;
  country: string | null;
  propertyType: PROPERTY_TYPE;
  yearBuilt: number | null;
  notes: string | null;
  purchasePrice: number;
  purchaseDate: string;
  valueAnchor: number | null;
  valueAnchorDate: string | null;
  annualAppreciationRatePct: number;
  valueLastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
  account: AccountApiResponse | null;
  /** The linked mortgage account, when `loanAccountId` is set and it was included in the query. */
  loanAccount: AccountApiResponse | null;
}

export function serializeProperty(property: Properties): PropertyApiResponse {
  return {
    id: property.id,
    accountId: property.accountId,
    userId: property.userId,
    loanAccountId: property.loanAccountId,
    address: property.address,
    city: property.city,
    country: property.country,
    propertyType: property.propertyType,
    yearBuilt: property.yearBuilt,
    notes: property.notes,
    purchasePrice: centsToApiDecimal(property.purchasePrice),
    purchaseDate: property.purchaseDate,
    valueAnchor: centsToApiDecimalOrNull(property.valueAnchor),
    valueAnchorDate: property.valueAnchorDate,
    annualAppreciationRatePct: Number(property.annualAppreciationRatePct),
    valueLastComputedAt: property.valueLastComputedAt ? property.valueLastComputedAt.toISOString() : null,
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
    account: property.account ? serializeAccount(property.account) : null,
    loanAccount: property.loanAccount ? serializeAccount(property.loanAccount) : null,
  };
}

export function serializeProperties(properties: Properties[]): PropertyApiResponse[] {
  return properties.map(serializeProperty);
}
