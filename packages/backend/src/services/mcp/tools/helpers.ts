import { type Feature, TRANSACTION_TRANSFER_NATURE, USER_ROLES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { RateLimitService } from '@services/common/rate-limit.service';
import type { UserRateLimit } from '@services/common/user-rate-limits';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import type { z } from 'zod';

/** The arguments a tool handler receives, typed from the plain shape it registers as `inputSchema`. */
export type ToolArgs<Shape extends z.ZodRawShape> = z.infer<z.ZodObject<Shape>>;

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
 * Refuses a demo user, as the `blockDemoUsers` middleware does on the REST routes that carry it.
 * `requireScope` calls it for every write; a read tool whose REST route carries `blockDemoUsers`
 * (`GET /bank-data-providers/sync/status`) calls it directly.
 */
export function assertNotDemoUser({ extra }: { extra: { authInfo?: { extra?: { role?: string } } } }): void {
  if (extra?.authInfo?.extra?.role === USER_ROLES.demo) {
    throw new Error('This action is not available in demo mode. Sign up for a free account to unlock all features.');
  }
}

/**
 * Assert the caller's access token was granted a specific scope.
 * Write and delete MCP tools call this after getUserId to enforce scope gating.
 * Demo and read-only users are rejected here regardless of granted scopes: read tools
 * never call this helper, so those accounts keep read access but cannot mutate via MCP.
 *
 * `allowReadOnly` is for the few tools on REST routes in `READ_ONLY_ROUTES`
 * (`middlewares/entitlements.ts`), which a read-only user may call, and which carry no
 * `blockDemoUsers`. It skips both rejections and still checks the scope.
 */
export function requireScope({
  extra,
  scope,
  allowReadOnly = false,
}: {
  extra: { authInfo?: { scopes?: string[]; extra?: { role?: string; readOnly?: boolean } } };
  scope: string;
  allowReadOnly?: boolean;
}): void {
  if (!allowReadOnly) {
    assertNotDemoUser({ extra });

    // Missing entitlement info is treated as read-only: a write must never pass on an
    // auth payload that failed to carry it.
    if (extra?.authInfo?.extra?.readOnly !== false) {
      throw new Error('Your plan no longer includes editing. Subscribe to keep editing your data.');
    }
  }

  const scopes = extra?.authInfo?.scopes ?? [];
  if (!scopes.includes(scope)) {
    throw new Error(`Missing required scope: ${scope}. Re-connect the app and grant it.`);
  }
}

/**
 * Refuses a call when the user's plan lacks the feature, as the REST `requireFeature` gate does
 * (402 with the same message). The features come from the entitlements `verifyAccessToken` already
 * resolves; a payload without them counts as having none, so a gate never opens on missing data.
 */
export function requireFeatureAccess({
  extra,
  feature,
}: {
  extra: { authInfo?: { extra?: { features?: readonly Feature[] } } };
  feature: Feature;
}): void {
  const features = extra?.authInfo?.extra?.features ?? [];
  if (!features.includes(feature)) {
    throw new Error('This feature is not included in your current plan.');
  }
}

/**
 * Refuses a write while a base-currency change is recalculating the user's amounts, as the
 * `checkBaseCurrencyLock` middleware does on the REST routes. Fails closed when Redis is
 * unreachable, since a write that slips past the lock would be rewritten by the recalculation.
 */
export async function assertBaseCurrencyUnlocked({ userId }: { userId: number }): Promise<void> {
  let locked: boolean;
  try {
    locked = await isBaseCurrencyChangeLocked({ userId });
  } catch (error) {
    logger.error({
      message: 'Base currency lock check failed',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw new Error(t({ key: 'common.serviceTemporarilyUnavailable' }), { cause: error });
  }

  if (locked) {
    throw new Error(t({ key: 'currencies.baseCurrencyChangeInProgress' }));
  }
}

/**
 * Draws one call from a per-user budget the REST middleware also enforces, and refuses the call
 * when the budget is spent. Redis being down lets the call through, as the middleware does for
 * these routes: `checkRateLimit` resolves `allowed: true` then.
 */
export async function enforceUserRateLimit({ userId, limit }: { userId: number; limit: UserRateLimit }): Promise<void> {
  const result = await RateLimitService.checkRateLimit(limit.key({ userId }), limit.windowSeconds, limit.maxAttempts);

  if (!result.allowed) {
    throw new Error(t({ key: 'middleware.tooManyRequests' }));
  }
}

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
