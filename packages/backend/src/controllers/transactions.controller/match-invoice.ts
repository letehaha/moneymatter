import { API_ERROR_CODES, FEATURES, TRANSACTION_TYPES } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ForbiddenError, ValidationError } from '@js/errors';
import { getRequestFeatureAccess } from '@middlewares/entitlements';
import { matchInvoice } from '@services/invoice-matching/match-invoice.service';
import { z } from 'zod';

const schema = z.object({
  query: z.object({ transactionType: z.nativeEnum(TRANSACTION_TYPES).default(TRANSACTION_TYPES.expense) }),
});

export default createController(
  schema,
  async ({ user, query, req }) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ValidationError({ message: t({ key: 'invoiceMatching.noFileUploaded' }) });
    }

    const access = await getRequestFeatureAccess({ req, feature: FEATURES.invoice_matching });
    if (access === 'denied') {
      throw new ForbiddenError({
        code: API_ERROR_CODES.planRequired,
        message: 'This feature is not included in your current plan.',
      });
    }

    const data = await matchInvoice({
      userId: user.id,
      bytes: body,
      transactionType: query.transactionType,
      access,
    });

    return { data };
  },
  { inBackground: true },
);
