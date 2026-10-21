import type { CreateGoalPayload, GoalModel, RecordId, UpdateGoalPayload } from '@bt/shared/types';

import { createAccount } from './account';
import { makeRequest } from './common';

/** Without `accounts` this makes one eligible account backing the goal at 100%. */
export async function createGoal<R extends boolean | undefined = false>({
  payload = {},
  raw,
}: {
  payload?: Partial<CreateGoalPayload>;
  raw?: R;
} = {}) {
  const accounts = payload.accounts ?? [{ accountId: (await createAccount({ raw: true })).id, sharePercent: 100 }];

  return makeRequest<GoalModel, R>({
    method: 'post',
    url: '/goals',
    payload: {
      name: 'Test goal',
      currencyCode: global.BASE_CURRENCY.code,
      targetAmount: 1000,
      ...payload,
      accounts,
    },
    raw,
  });
}

export function listGoals<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<GoalModel[], R>({ method: 'get', url: '/goals', raw });
}

export function getGoal<R extends boolean | undefined = false>({ goalId, raw }: { goalId: RecordId; raw?: R }) {
  return makeRequest<GoalModel, R>({ method: 'get', url: `/goals/${goalId}`, raw });
}

export function updateGoal<R extends boolean | undefined = false>({
  goalId,
  payload,
  raw,
}: {
  goalId: RecordId;
  payload: UpdateGoalPayload;
  raw?: R;
}) {
  return makeRequest<GoalModel, R>({ method: 'patch', url: `/goals/${goalId}`, payload, raw });
}

export function deleteGoal<R extends boolean | undefined = false>({ goalId, raw }: { goalId: RecordId; raw?: R }) {
  return makeRequest<undefined, R>({ method: 'delete', url: `/goals/${goalId}`, raw });
}
