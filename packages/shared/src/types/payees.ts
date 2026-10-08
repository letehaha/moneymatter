import type { EmbeddedCategoryModel } from './categories';
import type { EntityLogoFields, LogoResolutionState } from './entity-logo';
import type { RecordId } from './record-id';
import type { TransactionLocation } from './transactions';

/**
 * How aggressively a Payee's `defaultCategoryId` overrides other categorization
 * sources.
 *
 * - `enforce`: `payee_rule` always wins – sets `categoryId` AND stamps
 *   `categorizationMeta.source = payee_rule`, so AI then skips the row via its
 *   "categorizationMeta IS NULL" filter. Good for narrow merchants where every
 *   transaction is clearly the same category (Spotify → Subscriptions).
 * - `hint`: `payee_rule` fills `categoryId` but leaves
 *   `categorizationMeta = null`. AI still runs and can pick a better category
 *   from the transaction description. Good for catch-all merchants where the
 *   default category is a reasonable fallback but per-tx context matters
 *   (Amazon → "iPhone" vs "Garden tool").
 * - `off`: `payee_rule` does NOT apply at all. The Payee is still linked, but
 *   `categoryId` and `categorizationMeta` are left untouched so AI starts from
 *   scratch.
 */
export enum CATEGORIZATION_MODE {
  enforce = 'enforce',
  hint = 'hint',
  off = 'off',
}

export interface PayeeAliasModel {
  id: RecordId;
  payeeId: RecordId;
  rawName: string;
  normalizedName: string;
  /**
   * True when this alias's normalizedName equals the owning Payee's canonical
   * normalizedName. The canonical alias cannot be deleted (the API rejects
   * with 422) – clients should hide the delete affordance instead of
   * re-deriving normalization rules.
   */
  isCanonical: boolean;
  createdAt: Date;
}

/**
 * `details` payload on 409 responses from payee name/alias writes (create
 * payee, rename, create alias, add ignored name) when the submitted name
 * already resolves to a different Payee in the user's namespace.
 */
export interface PayeeNameConflictDetails {
  conflictingPayee: {
    id: RecordId;
    name: string;
  };
}

export interface PayeeModel extends EntityLogoFields {
  id: RecordId;
  userId: number;
  name: string;
  normalizedName: string;
  defaultCategoryId: RecordId | null;
  /** Controls how strongly `defaultCategoryId` applies during create-tx –
   *  see CATEGORIZATION_MODE for semantics. */
  categorizationMode: CATEGORIZATION_MODE;
  /**
   * Tags auto-applied to transactions linked to this Payee at creation/sync
   * time (skipped when the caller supplies an explicit tag list). Empty array
   * means no tag rule.
   */
  defaultTagIds: RecordId[];
  /** Stamped onto transactions linked to this Payee that carry no location of their own. */
  defaultLocation: TransactionLocation | null;
  /** How logoDomain was resolved – see LogoResolutionState. 'manual' can pair
   *  with a null logoDomain (user explicitly cleared the logo); null only before
   *  the Payee has been through a resolution pass. */
  logoSource: LogoResolutionState;
  createdAt: Date;
  updatedAt: Date;
  aliases?: PayeeAliasModel[];
  defaultCategory?: EmbeddedCategoryModel | null;
}

/**
 * Minimal Payee projection for client-side id→name/logo resolution (e.g. the
 * transaction table's beneficiary column). Returned by GET /payees/lookup for
 * the full payee set with no stats and no pagination, so any payee resolves
 * regardless of how many the user has.
 */
export interface PayeeLookupItem extends EntityLogoFields {
  id: RecordId;
  name: string;
}

/**
 * Stats aggregated at query time from `Transactions` for a Payee. Not stored –
 * computed from the `(userId, payeeId, time DESC)` index. Signed `netFlowRef`
 * works naturally for both income and expense Payees (income positive, expense
 * negative) and is reported in the user's ref currency as a decimal.
 */
export const PAYEE_SORT_FIELDS = ['lastSeen', 'name', 'netFlow', 'transactionCount', 'defaultTagsCount'] as const;
export type PayeeSortBy = (typeof PAYEE_SORT_FIELDS)[number];
export const PAYEE_SORT_DIRS = ['asc', 'desc'] as const;
export type PayeeSortDir = (typeof PAYEE_SORT_DIRS)[number];

export interface PayeeStats {
  payeeId: RecordId;
  transactionCount: number;
  netFlowRef: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  topCategoryId: RecordId | null;
}
