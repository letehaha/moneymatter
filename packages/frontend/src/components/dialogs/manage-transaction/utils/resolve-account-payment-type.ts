import { VERBOSE_PAYMENT_TYPES, type VerbosePaymentType } from '@/common/const';
import type { AccountModel } from '@bt/shared/types';

export const resolveAccountPaymentType = ({
  account,
  fallback,
}: {
  account: Pick<AccountModel, 'defaultPaymentType'> | null | undefined;
  fallback: VerbosePaymentType | null;
}): VerbosePaymentType | null =>
  VERBOSE_PAYMENT_TYPES.find((item) => item.value === account?.defaultPaymentType) ?? fallback;
