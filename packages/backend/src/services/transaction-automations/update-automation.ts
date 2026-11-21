import type { AutomationAction, AutomationConditions, RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import TransactionAutomations from '@models/transaction-automations.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';

import { collectAutomationCurrencyCodes, validateAutomationRefs } from './references';

/**
 * Partial update. Re-enabling re-checks every reference, so a rule paused by a
 * deleted category can't be switched back on while it is still broken. An update
 * that re-validates references clears `pausedReason`.
 */
export const updateAutomation = withTransaction(
  async ({
    userId,
    id,
    name,
    isEnabled,
    conditions,
    actions,
  }: {
    userId: number;
    id: RecordId;
    name?: string;
    isEnabled?: boolean;
    conditions?: AutomationConditions;
    actions?: AutomationAction[];
  }) => {
    const automation = await findOrThrowNotFound({
      query: TransactionAutomations.findOne({ where: { id, userId } }),
      message: t({ key: 'automations.automationNotFound' }),
    });

    if (conditions) {
      await assertCurrencyCodesVisible({
        userId,
        codes: collectAutomationCurrencyCodes({ conditions }),
        allowedWithoutPlan: collectAutomationCurrencyCodes({ conditions: automation.conditions }),
      });
    }

    const refsRevalidated = Boolean(conditions || actions || isEnabled === true);
    if (refsRevalidated) {
      await validateAutomationRefs({
        userId,
        conditions: conditions ?? automation.conditions,
        actions: actions ?? automation.actions,
      });
    }

    return automation.update({
      ...(name !== undefined && { name }),
      ...(isEnabled !== undefined && { isEnabled }),
      ...(conditions !== undefined && { conditions }),
      ...(actions !== undefined && { actions }),
      ...(refsRevalidated && { pausedReason: null }),
    });
  },
);
