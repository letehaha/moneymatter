import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { externalUrl, recordId } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { bankProviderRegistry } from '@services/bank-data-providers';
import { updateConnectionDetails } from '@services/bank-data-providers/connection/update-connection-details';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      connectionId: recordId(),
    }),
    body: z
      .object({
        providerName: z.string().min(1).max(255).optional(),
        credentials: z.record(z.string(), z.unknown()).optional(),
        externalUrl: externalUrl().nullish(),
      })
      .refine(
        (data) => data.providerName !== undefined || data.credentials !== undefined || data.externalUrl !== undefined,
        {
          message: 'At least one of providerName, credentials, or externalUrl must be provided',
        },
      ),
  }),
  async ({ user, params, body }) => {
    const connection = await findOrThrowNotFound({
      query: BankDataProviderConnections.findOne({
        where: {
          id: params.connectionId,
          userId: user.id,
        },
      }),
      message: t({ key: 'errors.connectionNotFound' }),
    });

    if (body.providerName !== undefined || body.externalUrl !== undefined) {
      await updateConnectionDetails({
        connectionId: connection.id,
        userId: user.id,
        providerName: body.providerName,
        externalUrl: body.externalUrl,
      });
      await connection.reload();
    }

    // If credentials are provided, validate and update via the provider
    if (body.credentials) {
      const provider = bankProviderRegistry.get(connection.providerType as BANK_PROVIDER_TYPE);
      await provider.refreshCredentials(connection.id, body.credentials);
      await connection.reload();
    }

    return {
      data: {
        connection: {
          id: connection.id,
          providerName: connection.providerName,
          providerType: connection.providerType,
          externalUrl: connection.externalUrl,
          isActive: connection.isActive,
          lastSyncAt: connection.lastSyncAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      },
    };
  },
);
