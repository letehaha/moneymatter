import type { ChatUncertainField } from '@bt/shared/types';
import { findTransactions } from '@models/transactions-query';

/** How many of the account's latest transactions say what it is usually paid with. */
const HISTORY_SIZE = 20;
/** Fewer than this and the history is no evidence. */
const MIN_HISTORY = 3;
/** The share of the history one payment type must reach to count as the account's usual one. */
const DOMINANT_SHARE = 0.6;
const PAYMENT_TYPE_FIELD = 'paymentType';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The payment type most of `types` share, or `null` when no type reaches the share or there is too little history. */
export function dominantPaymentType({ types }: { types: string[] }): string | null {
  if (types.length < MIN_HISTORY) return null;

  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);

  const [type, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return count / types.length >= DOMINANT_SHARE ? type : null;
}

/**
 * Checks the payment type of a transaction card against the account's own history. The model often guesses
 * "cash" or "credit card" for an account that is paid with a debit card; a disagreement with what the account
 * is usually paid with is marked on the card by the server, which is the only claim about history that was
 * actually checked. It replaces the model's own entry for the field, whatever reason that gave.
 */
export async function markAccountHistoryMismatch({
  userId,
  toolName,
  args,
  targetAccountId,
  uncertain,
}: {
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
  /** The account of the transaction an update targets, read by the preview; used when the call does not move it. */
  targetAccountId?: unknown;
  uncertain: ChatUncertainField[] | null;
}): Promise<ChatUncertainField[] | null> {
  const { paymentType } = args;
  const accountId = args.accountId ?? targetAccountId;
  if (toolName !== 'create_transaction' && toolName !== 'update_transaction') return uncertain;
  if (typeof accountId !== 'string' || !UUID.test(accountId) || typeof paymentType !== 'string') return uncertain;

  const recent = await findTransactions({
    planned: 'exclude',
    access: { accessibleTo: userId },
    balanceAdjustments: 'exclude',
    completeness: { page: { offset: 0, limit: HISTORY_SIZE } },
    where: { accountId },
    attributes: ['paymentType'],
    order: [['time', 'DESC']],
  });

  const usual = dominantPaymentType({ types: recent.map((transaction) => transaction.paymentType) });
  if (!usual || usual === paymentType) return uncertain;

  return [
    ...(uncertain ?? []).filter((entry) => entry.field !== PAYMENT_TYPE_FIELD),
    { field: PAYMENT_TYPE_FIELD, reason: 'accountHistoryMismatch', alternatives: [usual] },
  ];
}
