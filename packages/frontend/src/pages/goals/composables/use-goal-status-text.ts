import { useDateLocale } from '@/composable/use-date-locale';
import { goalDisplayStatus } from '@bt/shared/goals/goal-math';
import type { GoalModel, GoalProgress } from '@bt/shared/types';
import { parseISO } from 'date-fns';
import { useI18n } from 'vue-i18n';

import { getGoalStatusLabel } from '../helpers';

type StatusSource =
  | { goal: Pick<GoalModel, 'status' | 'achievedAt' | 'insights'> }
  | { progress: Pick<GoalProgress, 'status' | 'etaMonths' | 'daysLeft'>; today: string };

export const useGoalStatusText = () => {
  const { t } = useI18n();
  const { format } = useDateLocale();

  const formatMonth = (date: string) => format(parseISO(date), 'MMM yyyy');

  const statusText = (source: StatusSource) => {
    const label =
      'goal' in source
        ? getGoalStatusLabel({
            status: goalDisplayStatus(source.goal),
            progress: source.goal.insights,
            today: source.goal.insights?.input.today,
          })
        : getGoalStatusLabel({ status: source.progress.status, progress: source.progress, today: source.today });
    const params = { count: label.count ?? 0, date: label.date ? formatMonth(label.date) : '' };
    return label.count === undefined ? t(label.key, params) : t(label.key, params, label.count);
  };

  const targetDateText = ({ targetDate }: { targetDate: string | null }) =>
    targetDate ? t('goals.list.row.byDate', { date: formatMonth(targetDate) }) : t('goals.list.row.noDate');

  return { statusText, targetDateText };
};
