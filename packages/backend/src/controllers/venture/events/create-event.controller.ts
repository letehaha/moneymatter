import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { dateString, decimalString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVentureEvent } from '@root/serializers';
import { createVentureEvent } from '@services/venture/events/create.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ dealId: recordId() }),
    body: z.object({
      type: z.enum(VENTURE_EVENT_TYPE),
      eventDate: dateString(),
      grossAmount: decimalString().nullable().optional(),
      navAfter: decimalString().nullable().optional(),
      quantityPct: decimalString().nullable().optional(),
      cashFlowMode: z.enum(VENTURE_CASH_FLOW_MODE),
      transactionIds: z.array(recordId()).optional(),
      lpNetAmountOverride: decimalString().nullable().optional(),
      gpCarryOverride: decimalString().nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
    }),
  }),
  async ({ user, params, body }) => {
    const event = await createVentureEvent({
      userId: user.id,
      dealId: params.dealId,
      ...body,
    });
    return { data: serializeVentureEvent(event) };
  },
);
