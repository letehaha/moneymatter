import type { RecordId } from './record-id';

/**
 * Resource types that can be shared with other users.
 *
 * - `account`: a single account is shared.
 * - `household`: the recipient gains access to every account owned by the
 *   grantor. A household row is stored on `ResourceShares` with
 *   `resourceId = ownerUserId::text`; the per-row CHECK constraint enforces
 *   that shape so service-layer bugs cannot poison the table.
 * - `budget`: a single budget is shared. Recipients see the budget's metadata,
 *   stats, and linked transactions in full. `write` recipients can attach /
 *   detach **their own** transactions on manual budgets only – they cannot
 *   edit budget metadata, archive, or manage other recipients (all `manage`-
 *   only). Household membership does NOT auto-grant budget access; budgets
 *   are explicit-share only.
 */
export const RESOURCE_TYPES = {
  account: 'account',
  household: 'household',
  budget: 'budget',
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];

/**
 * How the caller can access a shared resource. Surfaced on the per-resource
 * `share` block so the frontend can render the right label and route the user
 * to the right management UI.
 *
 * - `owner`: the caller owns the resource.
 * - `share`: a per-resource `ResourceShares` row grants access directly.
 * - `household`: access derives from a household-membership row (the grantor
 *   shared every account they own with the caller).
 * - `budget`: indirect read-only visibility – caller has an accepted budget share
 *   and the resource is a transaction attached to that budget. Confers `read` only;
 *   write paths still require an account-level share.
 */
export const ACCESS_SOURCES = {
  owner: 'owner',
  share: 'share',
  household: 'household',
  budget: 'budget',
} as const;

export type AccessSource = (typeof ACCESS_SOURCES)[keyof typeof ACCESS_SOURCES];

/**
 * AccessSource narrowed to the values that can appear on a row in the shared-with-me list
 * (i.e. the caller is a recipient, never the owner). Used by the backend list service +
 * frontend API typing so a future regression can't accidentally feed `'owner'` through.
 */
export type SharedWithMeAccessSource = Exclude<AccessSource, typeof ACCESS_SOURCES.owner>;

/**
 * Permission levels granted on a shared resource.
 * - read: view the resource and its child entities
 * - write: read + create/update/delete child entities (subject to policy)
 * - manage: write + manage other recipients of the same resource (cannot delete the resource itself)
 *
 * Household rows (`resourceType = 'household'`) reject `manage` at the DB
 * level – owner-only operations remain owner-only regardless of household
 * membership.
 */
export const SHARE_PERMISSIONS = {
  read: 'read',
  write: 'write',
  manage: 'manage',
} as const;

export type SharePermission = (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];

/**
 * Permission levels valid for household membership. Household rows reject
 * `'manage'` at the DB level (the CHECK constraint on `ResourceShares` forbids
 * it), so this narrowed type prevents callers from constructing or comparing
 * against a value that can never appear in storage.
 */
export type HouseholdSharePermission = Exclude<SharePermission, 'manage'>;

/**
 * Status of a share invitation.
 */
export const SHARE_INVITATION_STATUSES = {
  pending: 'pending',
  accepted: 'accepted',
  declined: 'declined',
  revoked: 'revoked',
  expired: 'expired',
} as const;

export type ShareInvitationStatus = (typeof SHARE_INVITATION_STATUSES)[keyof typeof SHARE_INVITATION_STATUSES];

/**
 * Scope of write access for transactions on a shared account.
 * - all: can edit/delete any transaction on the shared account
 * - own: can edit/delete only transactions the recipient created
 *
 * Stored on `ResourceShares.policy.transactionsWriteScope` when `resourceType = 'account'`.
 */
export const TRANSACTIONS_WRITE_SCOPES = {
  all: 'all',
  own: 'own',
} as const;

export type TransactionsWriteScope = (typeof TRANSACTIONS_WRITE_SCOPES)[keyof typeof TRANSACTIONS_WRITE_SCOPES];

/**
 * Hardcoded sharing-related limits. Bumping these is a code-only change.
 *
 * Accepted-recipient caps live in `SEATS_BY_PLAN` (billing.ts) and are read
 * through `getEntitlementsByUserId().seats`.
 *
 * `maxPendingInvitationsPerResource` caps how many concurrent pending invitations a
 * single owner can have for one resource. The smaller test value keeps the relevant
 * boundary cheap to exercise in e2e tests; the dev/prod value is the real abuse-prevention
 * limit (per-recipient resend rate-limiting is the dedicated spam guard).
 *
 * Backend reads this via `getMaxPendingInvitationsPerResource()` in
 * `services/sharing/limits.ts` so the test override is centralized.
 */
export const SHARING_LIMITS = {
  maxPendingInvitationsPerResource: 10,
  maxPendingInvitationsPerResourceTest: 3,
  invitationExpirationDays: 7,
  // 32 random bytes encoded as base64url → exactly 43 ASCII chars (see generate-invitation-token.ts).
  invitationTokenLength: 43,
  resendPerInviteeRateLimit: { count: 3, windowMs: 24 * 60 * 60 * 1000 },
  // Owner-wide send cap to mitigate email-bombing across many resources. The per-resource
  // pending cap and the per-invitee resend rate limit cover the within-resource case; this
  // closes the cross-resource gap.
  sendInvitationsPerOwnerPer24h: 30,
  // Tighter test value so the gate is cheap to exercise in e2e (per-owner counter is
  // per-test thanks to the Redis truncate in `beforeEach`).
  sendInvitationsPerOwnerPer24hTest: 5,
} as const;

/**
 * Resource share block emitted on user-facing list/detail responses for any shareable
 * resource (accounts, budgets, …). Describes whether the requester owns the resource
 * or accesses it via an accepted share, plus the owner's display info.
 *
 * `accessSource` tells the frontend which kind of grant is in effect so it can pick
 * the right label and management entry point: per-resource shares keep the "Shared
 * by X" affordances, while household membership routes users into Settings → Household
 * for management. (Budgets never carry `'household'` – they're explicit-share only –
 * but the union stays open so a future selective-share extension doesn't force a type
 * widening.)
 */
export interface ResourceShareInfo {
  isOwner: boolean;
  owner: {
    id: number;
    username: string;
    avatar: string | null;
  };
  permission: SharePermission;
  policy: SharePolicy | null;
  accessSource: AccessSource;
}

/**
 * Granular policy overrides on top of a `permission` for a `ResourceShare`.
 * Stored as JSONB. All fields optional; missing fields fall back to defaults.
 *
 * - `transactionsWriteScope`: applies whenever a transaction mutation runs
 *   against an account the caller does not own. Default is `'all'`. Meaningful
 *   on both `account` rows (write/manage scope on that one account) and
 *   `household` rows (write scope across every account the grantor owns).
 *   Household rows never store `'manage'` permission (enforced by a DB CHECK
 *   constraint), so the field is read alongside `permission = 'write'`.
 */
export interface SharePolicy {
  transactionsWriteScope?: TransactionsWriteScope;
}

/**
 * Active access grant: user X may use resource Y at a given permission level.
 * Inactive (acceptedAt IS NULL) until the recipient accepts the invitation.
 */
export interface ResourceShareModel {
  id: RecordId;
  ownerUserId: number;
  sharedWithUserId: number;
  resourceType: ResourceType;
  /** String-encoded resource id (handles INTEGER and UUID-keyed resources uniformly). */
  resourceId: string;
  permission: SharePermission;
  policy: SharePolicy | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Outcome of the invitation email send attempt, reported to the inviter on the
 * create/resend/back-invite responses. `skipped` means no email provider is
 * configured on the server (the invite link must be shared manually);
 * `failed` means the provider was configured but the send errored.
 */
export type ShareInvitationEmailOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Pending offer to share a resource. Distinct from `ResourceShareModel` because
 * invitations may expire, be declined, or be revoked before acceptance, and we
 * want a separate audit trail.
 */
export interface ShareInvitationModel {
  id: RecordId;
  ownerUserId: number;
  inviteeEmail: string;
  /**
   * Resolved at invitation creation time when the email matches a registered
   * user. Kept nullable for forward-compatibility with auto-signup-from-invite.
   */
  inviteeUserId: number | null;
  resourceType: ResourceType;
  resourceId: string;
  permission: SharePermission;
  policy: SharePolicy | null;
  /** URL-safe random token used in accept/decline links. */
  token: string;
  status: ShareInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  /** Lifetime resend counter (audit). Bumped on every resend, never reset. */
  resendCount: number;
  /** ISO timestamps for resends within the rolling 24h rate-limit window. Pruned in-app on each resend. */
  recentResendsAt: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Preflight summary returned in the `details` of a 409 with code
 * `wipeDataSharingAcknowledgementRequired`. UI uses it to render a follow-up
 * acknowledgement dialog listing which resources will lose external access.
 */
export interface WipeDataSharedResources {
  /** Accounts the user OWNS that another user currently has share access to. */
  accounts: Array<{ id: RecordId; name: string; recipientUserId: number }>;
  /** Households the user OWNS with at least one accepted member. */
  households: Array<{ shareId: RecordId; recipientUserId: number; permission: HouseholdSharePermission }>;
}
