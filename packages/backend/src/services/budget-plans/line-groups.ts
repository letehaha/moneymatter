import { RecordId } from '@bt/shared/types';
import { BudgetPlanLineGroup } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { findGroup, findPlan } from './find-plan';

interface PlanParams {
  userId: number;
  planId: RecordId;
}

const toGroup = ({ group }: { group: BudgetLineGroups }): BudgetPlanLineGroup => ({
  id: group.id,
  name: group.name,
  sortOrder: group.sortOrder,
});

export const loadGroups = async ({ planId }: { planId: RecordId }): Promise<BudgetPlanLineGroup[]> => {
  const groups = await BudgetLineGroups.findAll({
    where: { planId },
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return groups.map((group) => toGroup({ group }));
};

/** The `sortOrder` that puts a line last in `groupId`, or among the ungrouped lines when it is null. */
export const endOfGroupSortOrder = async ({
  planId,
  groupId,
}: {
  planId: RecordId;
  groupId: RecordId | null;
}): Promise<number> => {
  if (groupId !== null && !(await BudgetLineGroups.findOne({ where: { id: groupId, planId } }))) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.groupNotFound' }) });
  }

  const max = await BudgetLines.max<number | null, BudgetLines>('sortOrder', { where: { planId, groupId } });
  return (max ?? -1) + 1;
};

const createGroupImpl = async ({ userId, planId, name }: PlanParams & { name: string }) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const max = await BudgetLineGroups.max<number | null, BudgetLineGroups>('sortOrder', { where: { planId: plan.id } });
  const group = await BudgetLineGroups.create({ planId: plan.id, name, sortOrder: (max ?? -1) + 1 });

  return toGroup({ group });
};

const updateGroupImpl = async ({ userId, planId, groupId, name }: PlanParams & { groupId: RecordId; name: string }) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const group = await findGroup({ planId: plan.id, groupId });
  await group.update({ name });

  return toGroup({ group });
};

/** Archived lines may stay behind: the FK drops them to ungrouped. */
const deleteGroupImpl = async ({ userId, planId, groupId }: PlanParams & { groupId: RecordId }): Promise<void> => {
  const plan = await findPlan({ planId, userId, lock: true });
  const group = await findGroup({ planId: plan.id, groupId });

  if (await BudgetLines.count({ where: { groupId: group.id, activeUntil: null } })) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.groupNotEmpty' }) });
  }

  await group.destroy();
};

/** Every group of the plan must be listed once; lines at most once, and unlisted ones keep their placement. */
const setLayoutImpl = async ({
  userId,
  planId,
  groups,
  ungroupedLineIds,
}: PlanParams & {
  groups: { id: RecordId; lineIds: RecordId[] }[];
  ungroupedLineIds: RecordId[];
}): Promise<void> => {
  const plan = await findPlan({ planId, userId, lock: true });
  const [planGroups, planLines] = await Promise.all([
    BudgetLineGroups.findAll({ where: { planId: plan.id } }),
    BudgetLines.findAll({ where: { planId: plan.id } }),
  ]);
  const groupsById = new Map(planGroups.map((group) => [group.id, group]));
  const linesById = new Map(planLines.map((line) => [line.id, line]));

  const groupIds = groups.map((group) => group.id);
  const placements = [
    ...groups.flatMap((group) => group.lineIds.map((lineId, index) => ({ lineId, groupId: group.id, index }))),
    ...ungroupedLineIds.map((lineId, index) => ({ lineId, groupId: null, index })),
  ];
  const lineIds = placements.map((placement) => placement.lineId);

  const valid =
    groupIds.length === groupsById.size &&
    new Set(groupIds).size === groupIds.length &&
    groupIds.every((id) => groupsById.has(id)) &&
    new Set(lineIds).size === lineIds.length &&
    lineIds.every((id) => linesById.has(id));
  if (!valid) throw new ValidationError({ message: t({ key: 'budgetPlans.layoutInvalid' }) });

  for (const [index, id] of groupIds.entries()) {
    const group = groupsById.get(id)!;
    if (group.sortOrder !== index) await group.update({ sortOrder: index });
  }

  for (const { lineId, groupId, index } of placements) {
    const line = linesById.get(lineId)!;
    if (line.groupId !== groupId || line.sortOrder !== index) await line.update({ groupId, sortOrder: index });
  }
};

export const createGroup = withTransaction(createGroupImpl);
export const updateGroup = withTransaction(updateGroupImpl);
export const deleteGroup = withTransaction(deleteGroupImpl);
export const setLayout = withTransaction(setLayoutImpl);
