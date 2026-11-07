import { dateRange, withDateOrder } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** `from` and `to` as REST requires them on the report routes: real `YYYY-MM-DD` calendar days. */
export const statsRangeInput = {
  from: dateRange({ required: true }).from.describe('Period start (YYYY-MM-DD, inclusive)'),
  to: dateRange({ required: true }).to.describe('Period end (YYYY-MM-DD, inclusive)'),
};

const orderedRangeSchema = withDateOrder(z.object(dateRange({ required: true })));

/** The `from <= to` rule the REST query schemas enforce; the MCP input shape cannot carry a cross-field check. */
export function assertStatsRangeOrder({ from, to }: { from: string; to: string }): void {
  orderedRangeSchema.parse({ from, to });
}
