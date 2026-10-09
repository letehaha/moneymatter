import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { bankProviderRegistry } from '@root/services/bank-data-providers';
import { EnableBankingProvider } from '@root/services/bank-data-providers/enablebanking';
import { queueConnectionSync } from '@root/services/bank-data-providers/sync/sync-manager';
import { z } from 'zod';

const schema = z.object({
  body: z.object({
    connectionId: recordId(),
    code: z.string().min(1, 'Authorization code is required'),
    state: z.string().min(1, 'State parameter is required'),
    error: z.string().optional(),
    error_description: z.string().optional(),
  }),
});

/**
 * POST /api/bank-data-providers/enablebanking/oauth-callback
 * Handle OAuth callback after user authorization
 */
export default createController(schema, async ({ body, user }) => {
  const { connectionId, code, state, error, error_description } = body;

  // Verify connection exists and belongs to user
  await findOrThrowNotFound({
    query: BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId: user.id,
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
      },
    }),
    message: t({ key: 'errors.connectionNotFoundOrNotYours' }),
  });

  // Get provider instance
  const provider = bankProviderRegistry.get(BANK_PROVIDER_TYPE.ENABLE_BANKING) as EnableBankingProvider;

  // Handle OAuth callback
  await provider.handleOAuthCallback(connectionId, {
    code,
    state,
    error,
    error_description,
  });

  // The OAuth code is single-use, so a failed enqueue must not fail the request:
  // the connection is already active and the user can still sync manually.
  try {
    await queueConnectionSync({ userId: user.id, connectionId });
  } catch (err) {
    logger.error(
      {
        message: `[Enable Banking] Failed to queue sync after OAuth callback for connection ${connectionId}`,
        error: err as Error,
      },
      { userId: user.id },
    );
  }

  return {
    data: {
      message: t({ key: 'bankDataProviders.connectionEstablished' }),
      connectionId,
    },
  };
});
