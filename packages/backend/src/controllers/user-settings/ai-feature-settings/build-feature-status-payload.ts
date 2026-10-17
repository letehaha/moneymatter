import { AIFeatureStatus, AI_FEATURE, FEATURES } from '@bt/shared/types';
import { getRequestEntitlements, getRequestFeatureAccess } from '@middlewares/entitlements';
import type { StoredAiSettings } from '@models/user-settings.model';
import { isWithinAiAllowance } from '@services/ai/ai-allowance';
import { resolveFeatureStatus } from '@services/user-settings/resolve-feature-model-display';
import type { Request } from 'express';

/** Receipt parsing also gets the server model on a free try of invoice matching, as `matchInvoice` grants it. */
export const resolveEntitledToServerKeys = async ({
  req,
  feature,
}: {
  req: Request;
  feature: AI_FEATURE;
}): Promise<boolean> => {
  if ((await getRequestFeatureAccess({ req, feature: FEATURES.operator_ai })) === 'plan') return true;

  return (
    feature === AI_FEATURE.receiptParsing &&
    (await getRequestFeatureAccess({ req, feature: FEATURES.invoice_matching })) === 'trial'
  );
};

export const isRequestWithinAiAllowance = async ({ req }: { req: Request }): Promise<boolean> =>
  isWithinAiAllowance({ userId: req.user!.id, entitlements: await getRequestEntitlements({ req }) });

/** A used-up AI allowance takes the server model away until the reset. */
const resolveServerKeysAllowed = async ({
  req,
  feature,
  withinAllowance,
}: {
  req: Request;
  feature: AI_FEATURE;
  withinAllowance: boolean;
}): Promise<boolean> => withinAllowance && (await resolveEntitledToServerKeys({ req, feature }));

export async function buildFeatureStatusPayload({
  req,
  feature,
  aiSettings,
  withinAllowance,
}: {
  req: Request;
  feature: AI_FEATURE;
  aiSettings: StoredAiSettings | null;
  withinAllowance: boolean;
}): Promise<AIFeatureStatus> {
  return resolveFeatureStatus({
    feature,
    aiSettings,
    serverKeysAllowed: await resolveServerKeysAllowed({ req, feature, withinAllowance }),
  });
}
