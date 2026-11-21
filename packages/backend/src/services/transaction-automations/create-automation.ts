import { AUTOMATION_LIMITS, type AutomationAction, type AutomationConditions } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import TransactionAutomations from '@models/transaction-automations.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';

import { collectAutomationCurrencyCodes, validateAutomationRefs } from './references';

export const createAutomation = withTransaction(
  async ({
    userId,
    name,
    isEnabled,
    conditions,
    actions,
  }: {
    userId: number;
    name: string;
    isEnabled?: boolean;
    conditions: AutomationConditions;
    actions: AutomationAction[];
  }) => {
    const existingCount = await TransactionAutomations.count({ where: { userId } });
    if (existingCount >= AUTOMATION_LIMITS.maxRules) {
      throw new ValidationError({ message: t({ key: 'automations.ruleLimitReached' }) });
    }

    await validateAutomationRefs({ userId, conditions, actions });
    await assertCurrencyCodesVisible({ userId, codes: collectAutomationCurrencyCodes({ conditions }) });

    const maxPosition = await TransactionAutomations.max<number | null, TransactionAutomations>('position', {
      where: { userId },
    });

    return TransactionAutomations.create({
      userId,
      name,
      isEnabled: isEnabled ?? true,
      conditions,
      actions,
      position: (maxPosition ?? -1) + 1,
    });
  },
);
