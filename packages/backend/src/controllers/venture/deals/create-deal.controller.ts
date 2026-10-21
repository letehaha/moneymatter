import { VENTURE_CASH_FLOW_MODE, VENTURE_SPV_SUBTYPE, VENTURE_VEHICLE_TYPE } from '@bt/shared/types/venture';
import { dateString, decimalString, isoCurrencyCode, percentageFraction, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVentureDeal } from '@root/serializers';
import { createVentureDeal } from '@services/venture/deals/create.service';
import { z } from 'zod';

export default createController(
  z.object({
    body: z.object({
      name: z.string().trim().min(1).max(255),
      currencyCode: isoCurrencyCode(),
      principal: decimalString(),
      investmentDate: dateString(),
      platformId: recordId().nullable().optional(),
      vehicleType: z.nativeEnum(VENTURE_VEHICLE_TYPE).optional(),
      spvSubtype: z.nativeEnum(VENTURE_SPV_SUBTYPE).nullable().optional(),
      targetCompany: z.string().max(255).nullable().optional(),
      entryFeePct: percentageFraction().optional(),
      entryFee: decimalString().optional(),
      mgmtFeePct: percentageFraction().optional(),
      carryPct: percentageFraction().optional(),
      hurdlePct: percentageFraction().optional(),
      expectedExitDate: dateString().nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
      initialInvestment: z
        .object({
          cashFlowMode: z.nativeEnum(VENTURE_CASH_FLOW_MODE),
          transactionIds: z.array(recordId()).optional(),
        })
        .optional(),
    }),
  }),
  async ({ user, body }) => {
    const deal = await createVentureDeal({ userId: user.id, ...body });
    return { data: serializeVentureDeal(deal) };
  },
);
