import { RECONCILIATION_MERGE_MAX, RECONCILIATION_MERGE_MIN, RECONCILIATION_REMOVE_MAX } from '@bt/shared/types';
import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Body of remove, restore and keep-as-booked: the REST controllers and the MCP tools share it. */
export const reconciliationIdsBodySchema = z.object({
  transactionIds: uniqueRecordIds({ min: 1, max: RECONCILIATION_REMOVE_MAX }),
});

export const reconciliationMergeBodySchema = z.object({
  transactionIds: uniqueRecordIds({ min: RECONCILIATION_MERGE_MIN, max: RECONCILIATION_MERGE_MAX }),
  survivorId: recordId(),
});
