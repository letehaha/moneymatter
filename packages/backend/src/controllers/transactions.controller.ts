import { SHARE_PERMISSIONS, TRANSACTIONS_WRITE_SCOPES } from '@bt/shared/types';
import { booleanQuery, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransaction, serializeTransactions } from '@root/serializers';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { isPermissionAtLeast } from '@services/sharing/auth/permission-rank';
import * as transactionsService from '@services/transactions';
import { attachPaymentParts } from '@services/transactions/payment-legs';
import { z } from 'zod';

export const getTransactionById = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    query: z.object({
      includeSplits: booleanQuery().optional(),
    }),
  }),
  async ({ user, params, query }) => {
    const { id } = params;
    const { id: userId } = user;
    const { includeSplits } = query;

    const fetched = await transactionsService.getTransactionById({
      id,
      userId,
      includeSplits,
      // The edit form seeds `tagIds` from this response; an absent `tags` array would make
      // the next save submit an empty tag set.
      includeTags: true,
    });

    if (!fetched) return { data: null };

    // Compute write-access from the already-resolved access result — no extra DB work.
    // The FE uses this on dialog open when the parent account isn't in its local
    // `accountsRecord` (typically the tracker-share-only case) to choose between the
    // editable form and the read-only details view.
    const { tx, access } = fetched;
    let canEdit = false;
    if (access.isOwner) {
      canEdit = true;
    } else if (isPermissionAtLeast({ granted: access.effectivePermission, required: SHARE_PERMISSIONS.write })) {
      const ownScopeBlocks =
        access.policy?.transactionsWriteScope === TRANSACTIONS_WRITE_SCOPES.own && tx.userId !== userId;
      canEdit = !ownScopeBlocks;
    }

    // Mutate the tx instance so the serializer's property-existence check picks it up.
    Object.assign(tx, { canEdit });
    await attachPaymentParts({
      transactions: [tx],
      collapsed: false,
      accessibleAccountIds: await getAccessibleAccountIdsForUser({ userId }),
    });

    return { data: serializeTransaction(tx) };
  },
);

export const getTransactionsByTransferId = createController(
  z.object({
    params: z.object({
      transferId: z.string(),
    }),
  }),
  async ({ user, params }) => {
    const { transferId } = params;
    const { id: userId } = user;

    const transactions = await transactionsService.getTransactionsByTransferId({
      transferId,
      userId,
    });

    // Serialize: convert cents to decimal for API response
    return { data: serializeTransactions(transactions) };
  },
);

export * from './transactions.controller/index';
