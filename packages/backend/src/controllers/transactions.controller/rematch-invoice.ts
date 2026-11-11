import { FEATURES, type InvoiceMatchResult } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { getRequestFeatureAccess } from '@middlewares/entitlements';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { invoiceSchema } from '@services/document-extraction/extract-invoice.service';
import { findInvoiceCandidates } from '@services/document-extraction/match-invoice.service';
import { z } from 'zod';

const schema = z.object({ body: invoiceSchema });

export default createController(schema, async ({ user, body, req }) => {
  // The route is gated on `attachments` alone, so this is the only thing keeping a user
  // with no invoice-matching access off the operator's TypeSafe budget.
  const allowJev = (await getRequestFeatureAccess({ req, feature: FEATURES.invoice_matching })) !== 'denied';

  const { candidates } = await findInvoiceCandidates({ userId: user.id, invoice: body, allowJev });

  const data: InvoiceMatchResult<TransactionApiResponse> = { invoice: body, candidates };

  return { data };
});
