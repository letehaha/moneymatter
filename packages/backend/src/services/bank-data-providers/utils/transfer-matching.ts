import { connection } from '@models/connection';
import type Transactions from '@models/transactions.model';
import { QueryTypes } from 'sequelize';

import { hasSettledStatus } from '../enablebanking/utils/transaction-metadata';

/** Bank transfers between own accounts typically settle within 1-2 business days. */
export const TRANSFER_DATE_WINDOW_DAYS = 3;

export function normalizeIban({ iban }: { iban: string }): string {
  return iban.replace(/\s/g, '').toUpperCase();
}

/**
 * Only settled rows may carry a transferId: on a pending row it blocks the pending-to-booked
 * upgrade and the booked copy lands as a duplicate. Monobank authorization holds are excluded
 * too, their amount still changes on settlement.
 */
export function isLinkableRow({ tx }: { tx: Transactions }): boolean {
  return hasSettledStatus({ tx }) && tx.externalData?.hold !== true;
}

/**
 * Serializes one user's transfer linking: two matchers running at once can claim overlapping
 * pairs and leave a leg holding a transferId with no counterpart. The lock also makes the later
 * run see the earlier one's committed rows. Must run inside a transaction; it is held until commit.
 */
export async function lockTransferLinking({ userId }: { userId: number }): Promise<void> {
  await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:scope), :userId)', {
    replacements: { scope: 'auto-link-transfers', userId },
    type: QueryTypes.SELECT,
  });
}
