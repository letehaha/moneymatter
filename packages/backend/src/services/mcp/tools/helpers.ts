import { type Feature, type GoalModel, TRANSACTION_TRANSFER_NATURE, USER_ROLES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import { FEATURE_NOT_IN_PLAN_MESSAGE, hasFeature } from '@services/entitlements/feature-trial.service';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import { slimGoalsForMcp } from '../serializers';

/**
 * Extract the app user ID from MCP request auth info.
 * Throws if the user is not authenticated.
 *
 * The `extra` parameter comes from the MCP SDK's RequestHandlerExtra.
 * Auth info is attached by our route handler and propagated through the SDK.
 */
export function getUserId({ extra }: { extra: { authInfo?: { extra?: { userId?: number } } } }): number {
  const userId = extra?.authInfo?.extra?.userId;
  if (!userId) {
    throw new Error('Authentication required. No user ID found in auth info.');
  }
  return userId;
}

/**
 * Assert the caller's access token was granted a specific scope.
 * Write and delete MCP tools call this after getUserId to enforce scope gating.
 * Demo and read-only users are rejected here regardless of granted scopes: read tools
 * never call this helper, so those accounts keep read access but cannot mutate via MCP.
 */
export function requireScope({
  extra,
  scope,
}: {
  extra: { authInfo?: { scopes?: string[]; extra?: { role?: string; readOnly?: boolean } } };
  scope: string;
}): void {
  if (extra?.authInfo?.extra?.role === USER_ROLES.demo) {
    throw new Error('This action is not available in demo mode. Sign up for a free account to unlock all features.');
  }

  // Missing entitlement info is treated as read-only: a write must never pass on an
  // auth payload that failed to carry it.
  if (extra?.authInfo?.extra?.readOnly !== false) {
    throw new Error('Your plan no longer includes editing. Subscribe to keep editing your data.');
  }

  const scopes = extra?.authInfo?.scopes ?? [];
  if (!scopes.includes(scope)) {
    throw new Error(`Missing required scope: ${scope}. Re-connect the app and grant it.`);
  }
}

/** MCP twin of the `requireFeature` route middleware; active feature trials count. */
export async function requireFeature({ userId, feature }: { userId: number; feature: Feature }): Promise<void> {
  if (!hasFeature({ entitlements: await getEntitlementsByUserId({ userId }), feature })) {
    throw new Error(`${FEATURE_NOT_IN_PLAN_MESSAGE} Upgrade, or start its free trial in the app.`);
  }
}

export const goalsForMcp = async ({ userId, goals }: { userId: number; goals: GoalModel[] }) => {
  const accountIds = [...new Set(goals.flatMap((goal) => goal.accounts.map(({ accountId }) => accountId)))];
  const accounts = accountIds.length
    ? await Accounts.findAll({ where: { userId, id: accountIds }, attributes: ['id', 'name'] })
    : [];
  return slimGoalsForMcp({ goals, accountNames: new Map(accounts.map(({ id, name }) => [id, name])) });
};

/**
 * Mirrors the REST transaction schemas: the original-currency pair is set (or cleared)
 * together, and never rides on a payload that makes the transaction a transfer.
 */
export function assertOriginalCurrencyArgs({
  args,
}: {
  args: {
    originalAmount?: number | null;
    originalCurrencyCode?: string | null;
    transferNature?: TRANSACTION_TRANSFER_NATURE;
    destinationAccountId?: unknown;
    destinationAmount?: unknown;
    destinationTransactionId?: unknown;
  };
}): void {
  const { originalAmount, originalCurrencyCode } = args;

  if (
    (originalAmount === undefined) !== (originalCurrencyCode === undefined) ||
    (originalAmount === null) !== (originalCurrencyCode === null)
  ) {
    throw new Error('"originalAmount" and "originalCurrencyCode" must be set, or cleared, together');
  }
  if (originalAmount == null) return;

  const isTransfer =
    (args.transferNature && args.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) ||
    args.destinationAccountId ||
    args.destinationAmount ||
    args.destinationTransactionId;
  if (isTransfer) {
    throw new Error('Original currency metadata cannot be added to transfer transactions');
  }
}

/** Return a JSON text content block for MCP tool responses. */
export function jsonContent({ data }: { data: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Parse scope string from DB — stored as JSON array or comma-separated string.
 */
export function parseScopes({ scopes }: { scopes: string | null }): string[] {
  if (!scopes) return [];

  try {
    const parsed = JSON.parse(scopes);
    if (Array.isArray(parsed)) return parsed;
    return scopes.split(',').map((s) => s.trim());
  } catch {
    return scopes.split(',').map((s) => s.trim());
  }
}
