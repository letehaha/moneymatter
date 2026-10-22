import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/** Checked against the tracker as it will be saved, so a partial edit cannot leave it half-configured. */
export const assertSmartTrackingConfig = ({
  aiEnabled,
  aiDescription,
  startDate,
}: {
  aiEnabled: boolean;
  aiDescription: string | null | undefined;
  startDate: Date | string | null | undefined;
}): void => {
  if (!aiEnabled) return;
  if (!aiDescription?.trim()) {
    throw new ValidationError({ message: t({ key: 'budgets.smartTracking.descriptionRequired' }) });
  }
  if (!startDate) {
    throw new ValidationError({ message: t({ key: 'budgets.smartTracking.startDateRequired' }) });
  }
};
