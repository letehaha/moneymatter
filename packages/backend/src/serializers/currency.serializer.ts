import type { CurrencyModel } from '@bt/shared/types';
import type Currencies from '@models/currencies.model';

export function serializeCurrency(currency: Currencies): CurrencyModel {
  return {
    currency: currency.currency,
    digits: currency.digits,
    number: currency.number,
    code: currency.code,
    isDisabled: currency.isDisabled,
    isCustom: currency.isCustom,
    symbol: currency.symbol,
  };
}
