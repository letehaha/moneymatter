import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE } from '@bt/shared/types/venture';
import { currencyCode, dateString, decimalString, percentageFraction, recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVentureDeal } from '@root/serializers';
import { updateVentureDeal } from '@services/venture/deals/update.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: z
      .object({
        name: z.string().trim().min(1).max(255).optional(),
        platformId: recordId().nullable().optional(),
        spvSubtype: z.nativeEnum(VENTURE_SPV_SUBTYPE).nullable().optional(),
        targetCompany: z.string().max(255).nullable().optional(),
        currencyCode: currencyCode().optional(),
        status: z.nativeEnum(VENTURE_DEAL_STATUS).optional(),
        principal: decimalString().optional(),
        entryFee: decimalString().optional(),
        entryFeePct: percentageFraction().optional(),
        mgmtFeePct: percentageFraction().optional(),
        carryPct: percentageFraction().optional(),
        hurdlePct: percentageFraction().optional(),
        investmentDate: dateString().optional(),
        expectedExitDate: dateString().nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
        ...logoFieldsShape,
      })
      .strict()
      .superRefine((data, ctx) => refineLogoFields({ data, ctx }))
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
      }),
  }),
  async ({ user, params, body }) => {
    const deal = await updateVentureDeal({ userId: user.id, dealId: params.id, ...body });
    return { data: serializeVentureDeal(deal) };
  },
);
