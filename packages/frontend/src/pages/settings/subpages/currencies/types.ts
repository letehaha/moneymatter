import type { EntityLogoFields, UserCurrencyModel } from '@bt/shared/types';

export type CurrencyWithExchangeRate = UserCurrencyModel & {
  name: string;
  rate: number;
  quoteCode: string;
  custom?: boolean;
  quoteRate: number;
  isCustomCurrency: boolean;
};

/** What the custom currency dialog edits: a custom currency as the user's currency list carries it. */
export interface EditableCustomCurrency extends EntityLogoFields {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
}
