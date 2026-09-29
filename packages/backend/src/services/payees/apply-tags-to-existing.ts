import { connection } from '@models/connection';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';
import { QueryTypes } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { loadPayeeOrThrow } from './payees.service';

interface ApplyPayeeTagsToExistingParams {
  userId: number;
  payeeId: string;
}

interface ApplyPayeeTagsToExistingResult {
  /** Distinct transactions that gained at least one tag. */
  updatedTransactionsCount: number;
}

/**
 * Retroactively apply a Payee's default tags to every transaction already
 * linked to that Payee. Explicit user action from the Payee detail page —
 * saving the tag rule itself only affects future transactions.
 *
 * Add-only merge: existing tags are never removed, duplicates are skipped
 * via `ON CONFLICT DO NOTHING` on the `TransactionTags` composite PK.
 */
export const applyPayeeTagsToExisting = withTransaction(
  async ({ userId, payeeId }: ApplyPayeeTagsToExistingParams): Promise<ApplyPayeeTagsToExistingResult> => {
    const payee = await loadPayeeOrThrow({ userId, id: payeeId });
    const tagIds = (payee.defaultTags ?? []).map((tag) => tag.id);
    if (tagIds.length === 0) {
      return { updatedTransactionsCount: 0 };
    }

    // Single INSERT…SELECT instead of loading every transaction into memory —
    // a payee can have thousands of rows. RETURNING reports only the pairs
    // that actually inserted (one row per tag, so de-duplicated by
    // transactionId below), which gives an exact "N transactions updated"
    // for the UI toast.
    const insertedRows: { transactionId: string }[] = await connection.sequelize.query(
      `
      INSERT INTO "TransactionTags" ("tagId", "transactionId")
      SELECT pt."tagId", t."id"
        -- planned-ok: the user asked for every row already linked to this payee,
        -- and a plan they linked by hand owns tags like any other row
        FROM "Transactions" t
        CROSS JOIN "PayeeTags" pt
       WHERE t."payeeId" = :payeeId
         AND t."userId" = :userId
         AND t."deletedAt" IS NULL
         AND pt."payeeId" = :payeeId
      ON CONFLICT DO NOTHING
      RETURNING "transactionId"
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { payeeId, userId },
      },
    );

    const updatedTransactionsCount = new Set(insertedRows.map((row) => row.transactionId)).size;

    if (updatedTransactionsCount > 0) {
      eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds, userId });
    }

    return { updatedTransactionsCount };
  },
);
