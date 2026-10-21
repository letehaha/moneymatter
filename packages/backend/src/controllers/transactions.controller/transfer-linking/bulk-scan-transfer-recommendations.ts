import type { BulkTransferScanMatch } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransaction, TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { bulkScanTransferRecommendations } from '@services/transactions/transactions-linking/bulk-scan-transfer-recommendations.service';
import { bulkScanBodySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { z } from 'zod';

interface BulkScanMatch extends Pick<BulkTransferScanMatch, 'confidence' | 'ai'> {
  transaction: TransactionApiResponse;
}

interface BulkScanItem {
  expense: TransactionApiResponse;
  matches: BulkScanMatch[];
}

interface BulkScanResponse {
  total: number;
  items: BulkScanItem[];
}

const schema = z.object({
  body: bulkScanBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { total, items } = await bulkScanTransferRecommendations({ userId: user.id, ...body });

  return {
    data: {
      total,
      items: items.map((item) => ({
        expense: serializeTransaction(item.expense),
        matches: item.matches.map((match) => ({
          transaction: serializeTransaction(match.transaction),
          confidence: match.confidence,
          ...(match.ai && { ai: match.ai as BulkScanMatch['ai'] }),
        })),
      })),
    } satisfies BulkScanResponse,
  };
});
