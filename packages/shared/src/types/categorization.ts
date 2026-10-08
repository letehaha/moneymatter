import type { CATEGORIZATION_SKIP_REASON, CATEGORIZATION_TRIGGER } from './ai/categorization';
import type { RecordId } from './record-id';

/**
 * Source of transaction categorization
 */
export enum CATEGORIZATION_SOURCE {
  manual = 'manual',
  ai = 'ai',
  mccRule = 'mcc_rule',
  userRule = 'user_rule',
  subscriptionRule = 'subscription_rule',
  payeeRule = 'payee_rule',
}

/**
 * Metadata about how a transaction was categorized.
 * Stored as JSONB in the database.
 */
export interface CategorizationMeta {
  source: CATEGORIZATION_SOURCE;
  /** TransactionAutomations.id for user_rule categorization */
  ruleId?: RecordId;
  /** Subscription ID for subscription_rule categorization */
  subscriptionId?: RecordId;
  /** Payee ID for payee_rule categorization */
  payeeId?: RecordId;
  /** ISO timestamp when categorization was applied */
  categorizedAt?: string;
  /** What started the AI run that wrote this stamp; only `source: ai` rows carry it */
  trigger?: CATEGORIZATION_TRIGGER;
  /** Present when the AI saw the row but declined to categorize it; the category was left untouched */
  skipReason?: CATEGORIZATION_SKIP_REASON;
}
