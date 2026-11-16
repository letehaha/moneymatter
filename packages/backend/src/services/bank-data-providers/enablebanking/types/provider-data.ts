import type { Cents } from '@bt/shared/types';

/**
 * Date range for querying transactions
 */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Transaction from external provider
 */
export interface ProviderTransaction {
  /** Provider's unique identifier for this transaction */
  externalId: string;
  /** Transaction amount in cents (positive for income, negative for expense) */
  amount: Cents;
  /** Currency code */
  currency: string;
  /** Transaction date */
  date: Date;
  /** Transaction description */
  description: string;
  /** Merchant/counterparty name */
  merchantName?: string;
  /** Transaction category (if provided by provider) */
  category?: string;
  /** Additional provider-specific data */
  metadata?: Record<string, unknown>;
}

/**
 * Account balance information from provider
 */
export interface ProviderBalance {
  /** Balance amount (in cents) */
  amount: Cents;
  /** Currency code */
  currency: string;
  /** Timestamp when balance was retrieved */
  asOf: Date;
}
