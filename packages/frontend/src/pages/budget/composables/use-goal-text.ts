import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { parseISO } from 'date-fns';
import { useI18n } from 'vue-i18n';

import type { GoalTextParam, GoalTextPart } from '../helpers';

export const useGoalText = () => {
  const { t } = useI18n();
  const { formatBaseCurrency } = useFormatCurrency();
  const { format } = useDateLocale();

  const formatParam = ({ param }: { param: GoalTextParam }): string | number => {
    if ('money' in param) return formatBaseCurrency(param.money);
    if ('date' in param) return format(parseISO(param.date), param.pattern);
    if ('weekday' in param) return t(`budgetPlans.goals.weekdays.${param.weekday}`);
    if ('part' in param) return goalText({ part: param.part });
    return param.value;
  };

  const goalText = ({ part }: { part: GoalTextPart }): string =>
    t(
      part.key,
      Object.fromEntries(Object.entries(part.params ?? {}).map(([name, param]) => [name, formatParam({ param })])),
    );

  return { goalText };
};
