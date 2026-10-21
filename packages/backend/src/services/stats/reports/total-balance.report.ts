import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { serializeTotalBalance } from '@root/serializers/stats.serializer';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { isValid } from 'date-fns';

import { getTotalBalance } from '../get-total-balance';

/** Total balance on `date` in the base currency, net of credit limits when the user setting is on. */
export const getTotalBalanceReport = async ({ userId, date }: { userId: number; date: string }) => {
  if (!isValid(new Date(date))) {
    throw new ValidationError({ message: t({ key: 'validation.dateInvalid' }) });
  }

  const settings = await getUserSettings({ userId });

  const totalBalance = await getTotalBalance({
    userId,
    date,
    includeCreditLimit: settings.includeCreditLimitInStats,
  });

  return serializeTotalBalance(totalBalance);
};
