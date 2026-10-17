import { type AIAllowance, type Entitlements, hasPaidPlus } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { redisClient } from '@root/redis-client';

import { getEntitlementsByUserId } from '../entitlements/resolve-entitlements.service';

const MICROS_PER_USD = 1_000_000;
const WARNING_RATIO = 0.6;
const KEY_TTL_SECONDS = 40 * 24 * 60 * 60;

const spendKey = ({ userId, now }: { userId: number; now: Date }) =>
  `ai-spend:${userId}:${now.toISOString().slice(0, 7)}`;

/** Unset means no cap, which is what self-hosters get. */
const monthlyCapUsd = ({ paidPlus }: { paidPlus: boolean }): number | null => {
  const envVar = paidPlus ? 'AI_MONTHLY_CAP_USD_PLUS' : 'AI_MONTHLY_CAP_USD_TRIAL';
  const raw = process.env[envVar];
  if (!raw) return null;

  const cap = Number(raw);
  if (Number.isFinite(cap) && cap >= 0) return cap;

  logger.error('Invalid AI cap env var, treating it as no cap', { envVar, raw });
  return null;
};

export const recordAiSpend = async ({ userId, costUsd }: { userId: number; costUsd: number }): Promise<void> => {
  if (costUsd <= 0) return;

  const key = spendKey({ userId, now: new Date() });
  try {
    await redisClient.incrby(key, Math.round(costUsd * MICROS_PER_USD));
    await redisClient.expire(key, KEY_TTL_SECONDS);
  } catch (error) {
    logger.error({ message: 'Failed to record AI spend', error: error as Error });
  }
};

/**
 * Null when no cap applies to the user. Fails open: an unreachable Redis reads as nothing spent.
 *
 * ponytail: checked before a call and recorded after it, so one big run can overshoot the cap.
 * Reserve spend up front if overshoot ever matters.
 */
export const getAiAllowance = async ({
  userId,
  entitlements,
}: {
  userId: number;
  entitlements?: Pick<Entitlements, 'plan' | 'subscriptions'>;
}): Promise<AIAllowance | null> => {
  const paidPlus = hasPaidPlus({ entitlements: entitlements ?? (await getEntitlementsByUserId({ userId })) });
  const capUsd = monthlyCapUsd({ paidPlus });
  if (capUsd === null) return null;

  const now = new Date();
  let spentMicros = 0;
  try {
    spentMicros = Number(await redisClient.get(spendKey({ userId, now }))) || 0;
  } catch (error) {
    logger.error({ message: 'Failed to read AI spend, treating it as zero', error: error as Error });
  }

  const ratio = capUsd === 0 ? 1 : spentMicros / (capUsd * MICROS_PER_USD);

  return {
    usedPercent: Math.min(100, Math.floor(ratio * 100)),
    state: ratio >= 1 ? 'reached' : ratio >= WARNING_RATIO ? 'warning' : 'ok',
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    plan: paidPlus ? 'plus' : 'trial',
  };
};

export const isWithinAiAllowance = async (params: Parameters<typeof getAiAllowance>[0]): Promise<boolean> =>
  (await getAiAllowance(params))?.state !== 'reached';
