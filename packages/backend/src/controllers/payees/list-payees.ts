import { PAYEE_SORT_DIRS, PAYEE_SORT_FIELDS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayeeWithStats } from './serializer';

const schema = z.object({
  query: z
    .object({
      q: z.string().trim().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sortBy: z.enum(PAYEE_SORT_FIELDS).optional(),
      sortDir: z.enum(PAYEE_SORT_DIRS).optional(),
      // Scope to a single account's owner (mirrors the categories
      // `?accountId=` pattern). On a shared account the recipient sees the
      // owner's payee set; on an owned account it falls through to the
      // caller's own set. Required for the transaction form's payee picker
      // on shared accounts so it resolves to the same namespace that the
      // backend write paths validate against.
      accountId: recordId().optional(),
    })
    .optional(),
});

export default createController(schema, async ({ user, query }) => {
  const rows = await payeesService.listPayees({
    userId: user.id,
    q: query?.q,
    limit: query?.limit,
    offset: query?.offset,
    sortBy: query?.sortBy,
    sortDir: query?.sortDir,
    accountId: query?.accountId,
  });
  return { data: rows.map((row) => serializePayeeWithStats(row)) };
});
