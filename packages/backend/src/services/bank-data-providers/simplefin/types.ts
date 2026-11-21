/**
 * SimpleFIN Bridge-specific types.
 *
 * SimpleFIN Protocol v2 returns monetary amounts as decimal strings
 * (e.g. "100.23", "-33293.43"; positive = deposit/credit) and all
 * timestamps as UNIX epoch SECONDS.
 *
 * We request `version=2`, which:
 *   - returns structured errors in `errlist` (objects) rather than the legacy
 *     plain-string `errors` array;
 *   - moves institution/org details out of each account into a top-level
 *     `connections` array, with each account referencing its connection via
 *     `conn_id`. (Under v1 the org block was embedded on the account instead.)
 * Both shapes are modelled below so we tolerate a v1 or v2 server.
 *
 * Protocol reference: https://www.simplefin.org/protocol.html
 */
import type { AuthTrackingMetadata } from '../types';

/**
 * Credentials we persist (encrypted) for a SimpleFIN connection.
 *
 * We store the long-lived Access URL — `https://<user>:<pass>@host/path` —
 * which carries HTTP Basic auth credentials. The one-time setup token the
 * user pastes is exchanged for this URL during `connect` and never stored.
 */
export interface SimplefinCredentials {
  accessUrl: string;
}

/**
 * What the user pastes into the connect form: a one-time, base64-encoded
 * setup token obtained from the SimpleFIN Bridge. Claimed exactly once to
 * produce the Access URL above.
 */
export interface SimplefinConnectInput {
  setupToken: string;
}

/**
 * Non-secret connection metadata stored alongside the encrypted credentials.
 */
export interface SimplefinMetadata extends AuthTrackingMetadata {
  /** Display name of the financial institution / org, when provided. */
  orgName?: string;
  accountCount?: number;
}

// ============================================================================
// SimpleFIN Protocol v2 response shapes
// ============================================================================

/**
 * Organization (financial institution) block. Embedded on each account under
 * protocol v1; under v2 this is absent and the same information lives in the
 * top-level {@link SimplefinConnection}.
 */
interface SimplefinOrg {
  domain?: string;
  name?: string;
  'sfin-url'?: string;
  url?: string;
  id?: string;
}

/**
 * A single structured error/warning (protocol v2 `errlist`). The `code` is a
 * dotted string whose prefix identifies severity/scope:
 *   - `gen.*`  — general (e.g. `gen.auth` = auth failure to the SimpleFIN server,
 *                `gen.api` = our own API misuse);
 *   - `con.*`  — connection-level (e.g. `con.auth` = the institution credentials
 *                are bad); carries `conn_id`;
 *   - `act.*`  — account-level (e.g. `act.failed`, `act.missingdata` = the
 *                transaction listing is incomplete); carries `account_id`.
 */
export interface SimplefinError {
  code: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

/**
 * Connection (one institution credential set) — protocol v2 `connections`.
 * Accounts reference their connection via `conn_id`; org details that v1
 * embedded on the account live here under v2.
 */
export interface SimplefinConnection {
  conn_id: string;
  name: string;
  org_id?: string;
  org_url?: string;
  'sfin-url'?: string;
}

/** A single transaction within an account. */
export interface SimplefinTransaction {
  id: string;
  /** UNIX epoch seconds. 0 when the transaction is still pending. */
  posted: number;
  /** Numeric string. Positive = deposit/credit, negative = debit. */
  amount: string;
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
  /** Optional UNIX epoch seconds for when the transaction actually occurred. */
  transacted_at?: number;
  extra?: Record<string, unknown>;
}

/** A single account in the AccountSet. */
export interface SimplefinAccount {
  /** Embedded org block (protocol v1). Absent under v2 — see `conn_id`. */
  org?: SimplefinOrg;
  /** Links this account to its entry in the top-level `connections` (v2). */
  conn_id?: string;
  id: string;
  name: string;
  /** ISO 4217 code (e.g. "USD") OR a URL for non-standard/crypto currencies. */
  currency: string;
  /** Numeric string. */
  balance: string;
  /** Numeric string. */
  'available-balance'?: string;
  /** UNIX epoch seconds. */
  'balance-date': number;
  transactions?: SimplefinTransaction[];
  extra?: Record<string, unknown>;
}

/** Top-level `/accounts` response (the "AccountSet"). */
export interface SimplefinAccountSet {
  /**
   * Structured errors/warnings (protocol v2). The bridge surfaces rate-limit
   * warnings and auth/connection problems here even on an HTTP 200, so callers
   * must inspect it — see the SimpleFIN guidance "always show those errors to
   * your end users".
   */
  errlist?: SimplefinError[];
  /** Legacy plain-string errors (protocol v1, deprecated by `errlist`). */
  errors?: string[];
  /** Connection metadata (protocol v2); resolves each account's org details. */
  connections?: SimplefinConnection[];
  accounts: SimplefinAccount[];
}

/** Query parameters accepted by the `/accounts` endpoint. */
export interface SimplefinGetAccountsParams {
  /** Start of the transaction window (inclusive lower bound). */
  startDate?: Date;
  /** End of the transaction window (EXCLUSIVE upper bound, per the protocol). */
  endDate?: Date;
  /** Restrict the response to a single account by its SimpleFIN id. */
  accountId?: string;
  /** Return account balances only, omitting transactions (cheap probe). */
  balancesOnly?: boolean;
}
