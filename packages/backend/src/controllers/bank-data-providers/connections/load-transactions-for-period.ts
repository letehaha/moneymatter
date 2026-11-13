import { API_ERROR_CODES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withAccountSyncLock } from '@root/services/bank-data-providers/connection/sync-transactions-for-account';
import { bankProviderRegistry } from '@root/services/bank-data-providers/registry';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      connectionId: recordId(),
    }),
    body: z.object({
      accountId: recordId(),
      from: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), { message: t({ key: 'bankDataProviders.fromMustBeValidDate' }) }),
      to: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), { message: t({ key: 'bankDataProviders.toMustBeValidDate' }) }),
    }),
  }),
  async ({ user, params, body }) => {
    const { connectionId } = params;
    const { accountId, from, to } = body;

    // Verify connection belongs to user
    const connection = await BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId: user.id,
      },
    });

    if (!connection) {
      throw new NotFoundError({
        message: t({ key: 'errors.connectionNotFound' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    // Verify account belongs to user and is linked to this connection
    const account = await Accounts.findOne({
      where: {
        id: accountId,
        userId: user.id,
        bankDataProviderConnectionId: connectionId,
      },
    });

    if (!account) {
      throw new NotFoundError({
        message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    // Check if account was linked using forward-only strategy and block historical loads before linkedAt
    const accountExternalData = account.externalData || {};
    const bankConnectionMetadata = accountExternalData.bankConnection;

    if (bankConnectionMetadata?.linkedAt && bankConnectionMetadata?.linkingStrategy === 'forward-only') {
      const linkedAt = new Date(bankConnectionMetadata.linkedAt);
      const requestedFrom = new Date(from);

      if (requestedFrom < linkedAt) {
        throw new ValidationError({
          message: t({
            key: 'bankDataProviders.cannotLoadBeforeLinkDate',
            variables: { linkedAt: linkedAt.toISOString() },
          }),
        });
      }
    }

    // Validate date range (max 1 year)
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const oneYearInMs = 365 * 24 * 60 * 60 * 1000;

    if (toDate.getTime() - fromDate.getTime() > oneYearInMs) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.dateRangeExceedsLimit' }),
      });
    }

    if (fromDate > toDate) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.fromAfterTo' }),
      });
    }

    // Dispatch to the provider. Only providers that support date-range
    // historical loads implement loadTransactionsForPeriod — Monobank via a
    // job queue, SimpleFIN inline. Providers without it reject the request.
    const provider = bankProviderRegistry.get(connection.providerType);
    const loadTransactionsForPeriod = provider.loadTransactionsForPeriod?.bind(provider);

    if (!loadTransactionsForPeriod) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.periodLoadNotSupported' }),
      });
    }

    const result = await withAccountSyncLock({
      accountIds: [accountId],
      fn: () =>
        loadTransactionsForPeriod({
          connectionId,
          systemAccountId: accountId,
          userId: user.id,
          from: fromDate,
          to: toDate,
        }),
    });

    // `jobGroupId === null` is the explicit marker for an inline provider
    // (e.g. SimpleFIN) that already finished — report the real created count.
    // A non-null jobGroupId means the work was queued (e.g. Monobank) and
    // progress arrives asynchronously.
    const isInlineLoad = result.jobGroupId === null;

    // A bare "loaded 0" is ambiguous, so when the provider reported how many
    // rows the window actually contained, distinguish "everything was already
    // imported" from "the provider has no data for this period".
    const inlineMessage = () => {
      const created = result.createdCount ?? 0;
      if (created > 0 || result.fetchedCount === undefined) {
        return t({ key: 'bankDataProviders.transactionsLoadedCount', variables: { count: created } });
      }
      return result.fetchedCount > 0
        ? t({ key: 'bankDataProviders.transactionsAllDuplicates', variables: { count: result.fetchedCount } })
        : t({ key: 'bankDataProviders.transactionsNoneInPeriod' });
    };

    return {
      data: {
        jobGroupId: result.jobGroupId,
        totalBatches: result.totalBatches,
        estimatedMinutes: result.estimatedMinutes,
        createdCount: result.createdCount,
        fetchedCount: result.fetchedCount,
        message: isInlineLoad
          ? inlineMessage()
          : t({
              key: 'bankDataProviders.transactionLoadingQueued',
              variables: { minutes: result.estimatedMinutes },
            }),
      },
    };
  },
);
