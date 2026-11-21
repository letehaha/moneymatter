import { BILLING_CYCLES, BILLING_TIERS } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { syncAppleTransaction as syncAppleTransactionService } from '@services/billing/apple/sync-transaction.service';
import { createCheckoutSession } from '@services/billing/checkout.service';
import { getPortalUrl } from '@services/billing/portal.service';
import { z } from 'zod';

export const createCheckout = createController(
  z.object({ body: z.object({ tier: z.enum(BILLING_TIERS), cycle: z.enum(BILLING_CYCLES) }) }),
  async ({ user, body }) => {
    const data = await createCheckoutSession({
      userId: user.id,
      plan: user.plan ?? null,
      tier: body.tier,
      cycle: body.cycle,
    });
    return { data };
  },
);

export const createPortalSession = createController(
  z.object({ body: z.object({ flow: z.literal('subscription_update').optional() }) }),
  async ({ user, body }) => {
    const data = await getPortalUrl({ userId: user.id, flow: body.flow });
    return { data };
  },
);

export const syncAppleTransaction = createController(
  z.object({ body: z.object({ signedTransaction: z.string().min(1).max(20_000) }) }),
  async ({ user, body }) => {
    const data = await syncAppleTransactionService({ userId: user.id, signedTransaction: body.signedTransaction });
    return { data };
  },
);
