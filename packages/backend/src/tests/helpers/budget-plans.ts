import type { SetBudgetLineGoalPayload, SetBudgetPlanLayoutPayload } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { createLine as _createLine } from '@services/budget-plans/create-line';
import { createPlan as _createPlan } from '@services/budget-plans/create-plan';
import { getPeriodView as _getPeriodView } from '@services/budget-plans/get-period-view';
import { getPlan as _getPlan, listPlans as _listPlans } from '@services/budget-plans/get-plan';
import { getScheduled as _getScheduled } from '@services/budget-plans/get-scheduled';
import { getTrends as _getTrends } from '@services/budget-plans/get-trends';
import { setLineGoal as _setLineGoal, snoozeLineGoal as _snoozeLineGoal } from '@services/budget-plans/line-goals';
import { createGroup as _createGroup, updateGroup as _updateGroup } from '@services/budget-plans/line-groups';
import { listPeriods as _listPeriods } from '@services/budget-plans/list-periods';
import { restoreLine as _restoreLine } from '@services/budget-plans/restore-line';
import { restorePlan as _restorePlan } from '@services/budget-plans/restore-plan';
import { setAssignment as _setAssignment } from '@services/budget-plans/set-assignment';
import { setPlanAccounts as _setPlanAccounts } from '@services/budget-plans/set-plan-accounts';
import {
  addSuggestedLines as _addSuggestedLines,
  getSuggestionContext as _getSuggestionContext,
} from '@services/budget-plans/suggested-lines';
import { updateLine as _updateLine } from '@services/budget-plans/update-line';
import { updatePlan as _updatePlan } from '@services/budget-plans/update-plan';

import { createAccount } from './account';
import { makeRequest } from './common';

type CreateBudgetPlanPayload = Omit<Parameters<typeof _createPlan>[0], 'userId'>;

/** A period start of the default monthly-on-the-1st payload, in UTC. */
export const budgetPeriodStart = ({ monthsAgo = 0 }: { monthsAgo?: number } = {}): string => {
  const now = new Date();
  return toUtcDateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)));
};

/** Monthly on the 1st, so every boundary in a test is `yyyy-MM-01`. */
const buildBudgetPlanPayload = (
  overrides: Partial<CreateBudgetPlanPayload> = {},
): Omit<CreateBudgetPlanPayload, 'accountIds'> => ({
  name: 'Test plan',
  type: 'category_caps',
  cadence: 'months',
  anchorDate: '2020-01-01',
  ...overrides,
});

/** Create demands a non-empty account set, so without `accountIds` this makes one attachable account. */
export async function createBudgetPlan<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload?: Partial<CreateBudgetPlanPayload>;
  raw?: R;
} = {}) {
  const accountIds = payload?.accountIds ?? [(await createAccount({ raw: true })).id];

  return makeRequest<Awaited<ReturnType<typeof _createPlan>>, R>({
    method: 'post',
    url: '/budget-plans',
    payload: { ...buildBudgetPlanPayload(payload), accountIds },
    raw,
  });
}

export function listBudgetPlans<R extends boolean | undefined = false>({
  includeDeleted,
  raw,
}: { includeDeleted?: boolean; raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof _listPlans>>, R>({
    method: 'get',
    url: '/budget-plans',
    payload: includeDeleted === undefined ? null : { includeDeleted },
    raw,
  });
}

export function getBudgetPlan<R extends boolean | undefined = false>({ planId, raw }: { planId: string; raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof _getPlan>>, R>({
    method: 'get',
    url: `/budget-plans/${planId}`,
    raw,
  });
}

export function updateBudgetPlan<R extends boolean | undefined = false>({
  planId,
  payload,
  raw,
}: {
  planId: string;
  payload: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updatePlan>>, R>({
    method: 'patch',
    url: `/budget-plans/${planId}`,
    payload,
    raw,
  });
}

export function deleteBudgetPlan<R extends boolean | undefined = false>({
  planId,
  permanent = false,
  raw,
}: {
  planId: string;
  permanent?: boolean;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'delete',
    url: `/budget-plans/${planId}${permanent ? '?permanent=true' : ''}`,
    raw,
  });
}

export function restoreBudgetPlan<R extends boolean | undefined = false>({
  planId,
  replace,
  raw,
}: {
  planId: string;
  replace?: boolean;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _restorePlan>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/restore`,
    payload: replace === undefined ? null : { replace },
    raw,
  });
}

export function setBudgetPlanAccounts<R extends boolean | undefined = false>({
  planId,
  accountIds,
  raw,
}: {
  planId: string;
  accountIds: string[];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _setPlanAccounts>>, R>({
    method: 'put',
    url: `/budget-plans/${planId}/accounts`,
    payload: accountIds === undefined ? null : { accountIds },
    raw,
  });
}

export function listBudgetPlanPeriods<R extends boolean | undefined = false>({
  planId,
  raw,
}: {
  planId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _listPeriods>>, R>({
    method: 'get',
    url: `/budget-plans/${planId}/periods`,
    raw,
  });
}

type CreateBudgetLinePayload = Omit<Parameters<typeof _createLine>[0], 'userId' | 'planId'>;
type UpdateBudgetLinePayload = Omit<Parameters<typeof _updateLine>[0], 'userId' | 'planId' | 'lineId'>;

export function createBudgetPlanLine<R extends boolean | undefined = false>({
  planId,
  payload,
  raw,
}: {
  planId: string;
  payload: CreateBudgetLinePayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _createLine>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/lines`,
    payload,
    raw,
  });
}

export function addSuggestedBudgetLines<R extends boolean | undefined = false>({
  planId,
  payload,
  headers,
  raw,
}: {
  planId: string;
  payload?: object;
  headers?: object;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _addSuggestedLines>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/suggested-lines`,
    payload,
    headers,
    raw,
  });
}

export function getBudgetSuggestionContext<R extends boolean | undefined = false>({
  accountIds,
  raw,
}: {
  accountIds?: string;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof _getSuggestionContext>>, R>({
    method: 'get',
    url: '/budget-plans/suggestion-context',
    payload: accountIds === undefined ? null : { accountIds },
    raw,
  });
}

export function updateBudgetPlanLine<R extends boolean | undefined = false>({
  planId,
  lineId,
  payload,
  raw,
}: {
  planId: string;
  lineId: string;
  payload: UpdateBudgetLinePayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updateLine>>, R>({
    method: 'patch',
    url: `/budget-plans/${planId}/lines/${lineId}`,
    payload,
    raw,
  });
}

export function archiveBudgetPlanLine<R extends boolean | undefined = false>({
  planId,
  lineId,
  raw,
}: {
  planId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'post',
    url: `/budget-plans/${planId}/lines/${lineId}/archive`,
    raw,
  });
}

export function deleteBudgetPlanLine<R extends boolean | undefined = false>({
  planId,
  lineId,
  raw,
}: {
  planId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'delete',
    url: `/budget-plans/${planId}/lines/${lineId}`,
    raw,
  });
}

export function restoreBudgetPlanLine<R extends boolean | undefined = false>({
  planId,
  lineId,
  raw,
}: {
  planId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _restoreLine>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/lines/${lineId}/restore`,
    raw,
  });
}

export function getBudgetPlanPeriodView<R extends boolean | undefined = false>({
  planId,
  periodId,
  raw,
}: {
  planId: string;
  periodId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPeriodView>>, R>({
    method: 'get',
    url: `/budget-plans/${planId}/periods/${periodId}`,
    raw,
  });
}

export function getBudgetPlanTrends<R extends boolean | undefined = false>({
  planId,
  until,
  count,
  raw,
}: {
  planId: string;
  until?: string;
  count?: number | string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getTrends>>, R>({
    method: 'get',
    url: `/budget-plans/${planId}/trends`,
    payload: {
      ...(until !== undefined ? { until } : {}),
      ...(count !== undefined ? { count: String(count) } : {}),
    },
    raw,
  });
}

export function getBudgetPlanScheduled<R extends boolean | undefined = false>({
  planId,
  periodId,
  raw,
}: {
  planId: string;
  periodId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getScheduled>>, R>({
    method: 'get',
    url: `/budget-plans/${planId}/periods/${periodId}/scheduled`,
    raw,
  });
}

type SetBudgetAssignmentPayload = Omit<
  Parameters<typeof _setAssignment>[0],
  'userId' | 'planId' | 'periodId' | 'lineId'
>;

export function setBudgetAssignment<R extends boolean | undefined = false>({
  planId,
  periodId,
  lineId,
  payload,
  raw,
}: {
  planId: string;
  periodId: string;
  lineId: string;
  payload: SetBudgetAssignmentPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _setAssignment>>, R>({
    method: 'put',
    url: `/budget-plans/${planId}/periods/${periodId}/lines/${lineId}/assignment`,
    payload,
    raw,
  });
}

export function setBudgetLineGoal<R extends boolean | undefined = false>({
  planId,
  lineId,
  payload,
  raw,
}: {
  planId: string;
  lineId: string;
  payload: SetBudgetLineGoalPayload;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _setLineGoal>>, R>({
    method: 'put',
    url: `/budget-plans/${planId}/lines/${lineId}/goal`,
    payload,
    raw,
  });
}

export function deleteBudgetLineGoal<R extends boolean | undefined = false>({
  planId,
  lineId,
  raw,
}: {
  planId: string;
  lineId: string;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'delete',
    url: `/budget-plans/${planId}/lines/${lineId}/goal`,
    raw,
  });
}

export function snoozeBudgetLineGoal<R extends boolean | undefined = false>({
  planId,
  lineId,
  periodId,
  raw,
}: {
  planId: string;
  lineId: string;
  periodId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _snoozeLineGoal>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/lines/${lineId}/goal/snooze`,
    payload: { periodId },
    raw,
  });
}

export function createBudgetLineGroup<R extends boolean | undefined = false>({
  planId,
  name,
  raw,
}: {
  planId: string;
  name: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _createGroup>>, R>({
    method: 'post',
    url: `/budget-plans/${planId}/groups`,
    payload: { name },
    raw,
  });
}

export function updateBudgetLineGroup<R extends boolean | undefined = false>({
  planId,
  groupId,
  name,
  raw,
}: {
  planId: string;
  groupId: string;
  name: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updateGroup>>, R>({
    method: 'patch',
    url: `/budget-plans/${planId}/groups/${groupId}`,
    payload: { name },
    raw,
  });
}

export function deleteBudgetLineGroup<R extends boolean | undefined = false>({
  planId,
  groupId,
  raw,
}: {
  planId: string;
  groupId: string;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'delete',
    url: `/budget-plans/${planId}/groups/${groupId}`,
    raw,
  });
}

export function setBudgetPlanLayout<R extends boolean | undefined = false>({
  planId,
  payload,
  raw,
}: {
  planId: string;
  payload: SetBudgetPlanLayoutPayload;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'put',
    url: `/budget-plans/${planId}/layout`,
    payload,
    raw,
  });
}
