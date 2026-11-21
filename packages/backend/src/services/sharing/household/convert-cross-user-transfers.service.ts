import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import Users from '@models/users.model';
import { Op } from 'sequelize';

interface AccountInfo {
  id: string;
  userId: number;
  name: string;
}

/**
 * Flips both legs of a `common_transfer` pair to `transfer_out_wallet`. Both legs lose
 * their `transferId`; each leg's `note` gains a one-line suffix describing the partner
 * (`Transfer to/from @{username} • {accountName}`) so the user keeps a paper trail of
 * where the funds went after the link is severed. Balances are unaffected — amount /
 * account / time / type stay put.
 *
 * Throws on any update failure so the surrounding cleanup transaction rolls back rather
 * than half-converting a pair.
 */
const convertPairLegs = async ({
  legs,
  accountById,
  usernameByUserId,
  errorContext,
}: {
  legs: [Transactions.default, Transactions.default];
  accountById: Map<string, AccountInfo>;
  usernameByUserId: Map<number, string | null>;
  errorContext: { code: string; trigger: string };
}) => {
  const [first, second] = legs;
  const firstAccount = accountById.get(first.accountId);
  const secondAccount = accountById.get(second.accountId);
  if (!firstAccount || !secondAccount) return false;

  for (const leg of legs) {
    const otherAccount = leg === first ? secondAccount : firstAccount;
    const otherUsername = usernameByUserId.get(otherAccount.userId);
    // expense leg = "money went out → to other"; income leg = "money came in → from other"
    const direction = leg.transactionType === TRANSACTION_TYPES.expense ? 'to' : 'from';
    const counterpartLabel = otherUsername ? `@${otherUsername} • ${otherAccount.name}` : otherAccount.name;
    const suffix = `Transfer ${direction} ${counterpartLabel}`;
    const newNote = leg.note ? `${leg.note}\n${suffix}` : suffix;

    const values = {
      transferId: null,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      note: newNote,
    };
    try {
      if (leg.deletedAt) {
        // A trashed leg's balance is already reversed, so the write must not fire balance hooks.
        await updateTransactions({
          values,
          where: { id: leg.id },
          paranoid: false,
          hooks: false,
          planned: 'include',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
        });
      } else {
        await Transactions.updateTransactionById({ id: leg.id, userId: leg.userId, ...values });
      }
    } catch (err) {
      logger.error(
        {
          message: `Failed to convert cross-user transfer leg on ${errorContext.trigger}`,
          error: err as Error,
        },
        {
          code: errorContext.code,
          transferId: leg.transferId,
          txId: leg.id,
          accountId: leg.accountId,
        },
      );
      throw err;
    }
  }
  return true;
};

/**
 * Converts any `common_transfer` pairs that span the two given users into independent
 * `transfer_out_wallet` rows. Triggered when a household membership between them ends
 * (leave / revoke), so a transfer that previously crossed the household boundary stops
 * advertising a partner the recipient can no longer see or touch.
 *
 * Same-user transfers on each side are untouched, even when the loop loads them as
 * candidates. The pair filter checks that the two legs' account owners are exactly
 * `userIdA` and `userIdB` in some order.
 */
export const convertCrossUserTransfersToOutOfWallet = async ({
  userIdA,
  userIdB,
}: {
  userIdA: number;
  userIdB: number;
}): Promise<{ convertedPairCount: number }> => {
  if (userIdA === userIdB) return { convertedPairCount: 0 };

  const accounts = (await Accounts.findAll({
    where: { userId: { [Op.in]: [userIdA, userIdB] } },
    attributes: ['id', 'userId', 'name'],
    raw: true,
  })) as unknown as AccountInfo[];

  const accountById = new Map<string, AccountInfo>();
  const accountIds: string[] = [];
  for (const account of accounts) {
    accountById.set(account.id, account);
    accountIds.push(account.id);
  }

  // Neither user has any accounts in scope — nothing could possibly need conversion.
  if (accountIds.length === 0) return { convertedPairCount: 0 };

  // Both users' rows are in scope by design, so the account-id list is the only scope.
  const candidates = await findTransactions({
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.common_transfer] },
    completeness: 'all',
    where: {
      transferId: { [Op.not]: null },
      accountId: { [Op.in]: accountIds },
    },
    paranoid: false,
  });

  // Group candidates by `transferId` so each pair is processed exactly once. Any group
  // that isn't a clean pair (length !== 2, or both legs on the same user) is left alone.
  const byTransferId = new Map<string, Transactions.default[]>();
  for (const tx of candidates) {
    if (!tx.transferId) continue;
    const arr = byTransferId.get(tx.transferId) ?? [];
    arr.push(tx);
    byTransferId.set(tx.transferId, arr);
  }

  const [userA, userB] = await Promise.all([Users.findByPk(userIdA), Users.findByPk(userIdB)]);
  const usernameByUserId = new Map<number, string | null>([
    [userIdA, userA?.username ?? null],
    [userIdB, userB?.username ?? null],
  ]);

  let convertedPairCount = 0;

  for (const [, legs] of byTransferId) {
    if (legs.length !== 2) continue;
    const [first, second] = legs as [Transactions.default, Transactions.default];
    const firstAccount = accountById.get(first.accountId);
    const secondAccount = accountById.get(second.accountId);
    if (!firstAccount || !secondAccount) continue;
    const ownerPair = new Set([firstAccount.userId, secondAccount.userId]);
    const isAcrossThisPair = ownerPair.has(userIdA) && ownerPair.has(userIdB);
    if (!isAcrossThisPair) continue;

    const ok = await convertPairLegs({
      legs: [first, second],
      accountById,
      usernameByUserId,
      errorContext: {
        code: 'CROSS_USER_TRANSFER_CONVERT_FAILED',
        trigger: 'share break',
      },
    });
    if (ok) convertedPairCount += 1;
  }

  return { convertedPairCount };
};

/**
 * Converts cross-user `common_transfer` pairs to out-of-wallet when one or more accounts
 * are about to be hard-deleted (account-delete or user-delete cascade). Without this,
 * the leg on the OTHER user's account would survive the FK CASCADE on `Transactions.accountId`
 * with a `transferId` pointing at a now-deleted partner — orphan half-transfer the UI can't
 * render coherently.
 *
 * Same-user pairs (both legs on the trigger accounts' owner) are intentionally left alone
 * — for account-delete the partner leg cascades naturally with the surviving same-user
 * account, and for user-delete both legs cascade away with the user's accounts. Only the
 * cross-user case needs explicit conversion to preserve the surviving leg's coherence.
 *
 * Caller is responsible for invoking this BEFORE the parent destroy commits, so the
 * `updateTransactionById` calls still see live account / user rows.
 */
export const convertCrossUserTransfersForAccountIds = async ({
  accountIds,
  ownerUserId,
}: {
  accountIds: string[];
  ownerUserId: number;
}): Promise<{ convertedPairCount: number }> => {
  if (accountIds.length === 0) return { convertedPairCount: 0 };

  // Step 1: discover candidate transferIds — common_transfer rows on the trigger
  // accounts. Using `attributes` to keep the payload light; the full leg rows are
  // re-loaded in step 2 alongside the partners.
  const triggerLegStubs = (await findTransactions({
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.common_transfer] },
    completeness: 'all',
    where: {
      transferId: { [Op.not]: null },
      accountId: { [Op.in]: accountIds },
    },
    attributes: ['transferId'],
    raw: true,
    paranoid: false,
  })) as unknown as Array<{ transferId: string | null }>;

  const transferIds = Array.from(
    new Set(triggerLegStubs.map((row) => row.transferId).filter((id): id is string => Boolean(id))),
  );
  if (transferIds.length === 0) return { convertedPairCount: 0 };

  // Step 2: load every leg of those transfers (both the trigger-side leg and the partner
  // leg, which lives outside `accountIds`). This is what lets us identify the partner
  // user without an extra round-trip per pair.
  const allLegs = await findTransactions({
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.common_transfer] },
    completeness: 'all',
    where: { transferId: { [Op.in]: transferIds } },
    paranoid: false,
  });

  // Step 3: resolve the involved accounts + their owners' usernames so the per-pair
  // conversion can stamp the note suffix without an N-query.
  const involvedAccountIds: string[] = Array.from(new Set(allLegs.map((leg) => leg.accountId as string)));
  const accounts = (await Accounts.findAll({
    where: { id: { [Op.in]: involvedAccountIds } },
    attributes: ['id', 'userId', 'name'],
    raw: true,
  })) as unknown as AccountInfo[];
  const accountById = new Map<string, AccountInfo>(accounts.map((a) => [a.id, a]));

  const involvedUserIds = Array.from(new Set(accounts.map((a) => a.userId)));
  const users = (await Users.findAll({
    where: { id: { [Op.in]: involvedUserIds } },
    attributes: ['id', 'username'],
    raw: true,
  })) as unknown as Array<{ id: number; username: string | null }>;
  const usernameByUserId = new Map<number, string | null>(users.map((u) => [u.id, u.username ?? null]));

  // Step 4: group by transferId, convert each cross-user pair.
  const byTransferId = new Map<string, Transactions.default[]>();
  for (const leg of allLegs) {
    if (!leg.transferId) continue;
    const arr = byTransferId.get(leg.transferId) ?? [];
    arr.push(leg);
    byTransferId.set(leg.transferId, arr);
  }

  let convertedPairCount = 0;

  for (const [, legs] of byTransferId) {
    if (legs.length !== 2) continue;
    const [first, second] = legs as [Transactions.default, Transactions.default];
    const firstAccount = accountById.get(first.accountId);
    const secondAccount = accountById.get(second.accountId);
    if (!firstAccount || !secondAccount) continue;

    // Same-user pairs cascade-delete naturally (both legs go with the user's accounts
    // for user-delete; the partner leg goes with the surviving same-user account for
    // account-delete). No conversion needed.
    if (firstAccount.userId === secondAccount.userId) continue;

    // Defensive: the candidate query restricts the trigger side to `accountIds`, so at
    // least one leg must already be on `ownerUserId`'s account. This guard is belt-and-
    // suspenders against future query changes that might widen the candidate set.
    if (firstAccount.userId !== ownerUserId && secondAccount.userId !== ownerUserId) continue;

    const ok = await convertPairLegs({
      legs: [first, second],
      accountById,
      usernameByUserId,
      errorContext: {
        code: 'CROSS_USER_TRANSFER_CONVERT_FAILED_ON_DELETE',
        trigger: 'account/user delete',
      },
    });
    if (ok) convertedPairCount += 1;
  }

  return { convertedPairCount };
};
