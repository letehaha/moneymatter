import type { z } from 'zod';

import type { AuthTrackingMetadata } from '../types';
import type { plaidCredentialsSchema } from './api-client';

export type PlaidCredentials = z.infer<typeof plaidCredentialsSchema>;

export interface PlaidMetadata extends AuthTrackingMetadata {
  plaidCursors?: Record<string, { externalId: string; linkedAt: string | null; value: string }>;
}
