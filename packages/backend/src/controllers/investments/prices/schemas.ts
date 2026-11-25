import { booleanQuery, dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Query of `GET /investments/prices`; the MCP `get_security_prices` tool reads its shape. */
export const securityPricesQuerySchema = withDateOrder(
  z.object({
    ...dateRange({ precision: 'datetime' }),
    securityId: recordId().optional(),
    /** One close per UTC day (the day's last row), oldest first. */
    daily: booleanQuery().optional(),
  }),
);
