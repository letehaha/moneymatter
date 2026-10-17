import { UserCurrencyModel } from '@bt/shared/types';

export type CurrencyWithExchangeRate = UserCurrencyModel & {
  rate: number;
  quoteCode: string;
  custom?: boolean;
  quoteRate: number;
};

/** What the custom currency dialog edits: a custom currency as the user's currency list carries it. */
export interface EditableCustomCurrency {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
}
