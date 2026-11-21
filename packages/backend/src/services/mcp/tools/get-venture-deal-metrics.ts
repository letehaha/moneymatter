import { dateString, recordId } from '@common/lib/zod/custom-types';
import { getDealMetrics } from '@services/venture/metrics/get-deal-metrics.service';

import { defineTool } from '../define-tool';

export const getVentureDealMetricsTool = defineTool({
  name: 'get_venture_deal_metrics',
  toolset: 'ventures',
  access: 'read',
  description:
    'Compute aggregated metrics for a venture deal: cost basis, current value (latest NAV), total distributions, absolute and percent P&L, TVPI (total value to paid-in), DPI (distributions to paid-in), and IRR. IRR returns null for degenerate cash flows (e.g. no inflows yet). Pass asOfDate (YYYY-MM-DD) to compute metrics as of a specific date.',
  input: {
    dealId: recordId().describe('Venture deal ID (from list_venture_deals)'),
    asOfDate: dateString().optional().describe('Compute metrics as of this date (YYYY-MM-DD). Defaults to today.'),
  },
  run: ({ userId, args }) =>
    getDealMetrics({
      userId,
      dealId: args.dealId,
      asOfDate: args.asOfDate ? new Date(args.asOfDate) : undefined,
    }),
});
