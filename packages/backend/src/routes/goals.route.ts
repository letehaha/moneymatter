import { FEATURES } from '@bt/shared/types';
import createGoal from '@controllers/goals/create-goal';
import deleteGoal from '@controllers/goals/delete-goal';
import { getGoal, listGoals } from '@controllers/goals/get-goals';
import updateGoal from '@controllers/goals/update-goal';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature } from '@middlewares/entitlements';
import { Router } from 'express';

// `/goals` serves savings goals; envelope line goals live under budget-plans.route.ts.
const router = Router({});
const gatedWrite = [authenticateSession, requireFeature(FEATURES.goals), checkBaseCurrencyLock];

// Reads stay ungated so a lapsed user keeps seeing their goals.
router.get('/', authenticateSession, listGoals);
router.get('/:goalId', authenticateSession, getGoal);

router.post('/', ...gatedWrite, createGoal);
router.patch('/:goalId', ...gatedWrite, updateGoal);
router.delete('/:goalId', ...gatedWrite, deleteGoal);

export default router;
