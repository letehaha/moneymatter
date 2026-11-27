import type { AuthTrackingMetadata } from '../types';

export interface PlaidCredentials {
  access_token: string;
  item_id: string;
}

export interface PlaidMetadata extends AuthTrackingMetadata {
  plaidCursors?: Record<string, { externalId: string; linkedAt: string | null; value: string }>;
}
