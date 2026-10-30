import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePortfolio } from '@services/investments/portfolios/update.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    body: z
      .object({
        name: z.string().min(1).max(255).optional(),
        portfolioType: z.nativeEnum(PORTFOLIO_TYPE).optional(),
        description: z.string().nullable().optional(),
        displayCurrencyCode: currencyCode().nullable().optional(),
        isEnabled: z.boolean().optional(),
        ...logoFieldsShape,
      })
      .strict()
      .superRefine((data, ctx) => refineLogoFields({ data, ctx }))
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
      }),
  }),
  async ({ user, params, body }) => {
    const portfolio = await updatePortfolio({
      userId: user.id,
      portfolioId: params.id,
      ...body,
    });

    return { data: portfolio };
  },
);
