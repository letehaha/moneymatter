import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { archiveLine } from '@services/budget-plans/archive-line';
import { restoreLine } from '@services/budget-plans/restore-line';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const archiveBudgetPlanLineTool = defineTool({
  name: 'archive_budget_plan_line',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Archive a line of a budget plan (archived: true) or bring an archived one back (archived: false). Archiving ends the line at the start of the current period: its past periods stay, the amounts assigned to later periods are removed, and its categories become free for another line. Restoring resumes it from the current period with the categories it held when archived; it fails if another line has taken any of them. Archiving returns { archived: true, id, planId }; restoring returns the line { id, name, sortOrder, groupId, activeFrom, activeUntil, categoryIds }. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    lineId: recordId().describe('Line ID (from get_budget_plan_period)'),
    archived: z
      .boolean()
      .describe(
        'true: archive the line from the current period on. false: restore an archived line into the current period',
      ),
  },
  run: async ({ userId, args }) => {
    const { planId, lineId, archived } = args;
    if (archived) {
      await archiveLine({ userId, planId, lineId });

      return { archived: true, id: lineId, planId };
    }

    return restoreLine({ userId, planId, lineId });
  },
});
