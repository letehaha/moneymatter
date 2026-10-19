import { BUDGET_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/** Checked against the tracker as it will be saved, so a partial edit cannot leave it half-configured. */
export const assertSmartTrackingConfig = ({
  type,
  aiEnabled,
  aiDescription,
  startDate,
}: {
  type: BUDGET_TYPES;
  aiEnabled: boolean;
  aiDescription: string | null | undefined;
  startDate: Date | string | null | undefined;
}): void => {
  if (!aiEnabled) return;
  if (type !== BUDGET_TYPES.manual) {
    throw new ValidationError({ message: t({ key: 'budgets.smartTracking.manualOnly' }) });
  }
  if (!aiDescription?.trim()) {
    throw new ValidationError({ message: t({ key: 'budgets.smartTracking.descriptionRequired' }) });
  }
  if (!startDate) {
    throw new ValidationError({ message: t({ key: 'budgets.smartTracking.startDateRequired' }) });
  }
};
