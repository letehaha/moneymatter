/**
 * Account and Balance Types
 * https://enablebanking.com/docs/api/reference/
 */
import {
  AccountIdentification,
  AmountType,
  FinancialInstitutionIdentification,
  GenericIdentification,
  PostalAddress,
} from './common';
import { BalanceStatus, CashAccountType, Usage } from './enums';

/**
 * Account details from Enable Banking
 * https://enablebanking.com/docs/api/reference/#accountresource
 */
export interface EnableBankingAccount {
  /**
   * Primary account identification hash. Stable across sessions.
   * Can be used for matching accounts between multiple sessions
   * (even in case the sessions are authorized by different PSUs).
   */
  identification_hash: string;

  /**
   * All identification hashes for this account.
   * Multiple hashes may exist due to different identification schemes.
   */
  identification_hashes: string[];

  /** Account type */
  cash_account_type: CashAccountType;

  /** Account currency (ISO 4217) */
  currency: string;

  /**
   * Session-specific unique identifier.
   * Changes on each authorization - do NOT use for cross-session matching.
   */
  uid?: string;

  /** Account identification (IBAN and/or other) */
  account_id?: AccountIdentification;

  /** All account identifications */
  all_account_ids?: GenericIdentification[];

  /** Account servicer (bank) information */
  account_servicer?: FinancialInstitutionIdentification;

  /** Account name/label */
  name?: string;

  /** Account details/description */
  details?: string;

  /** Account usage type */
  usage?: Usage;

  /** Account product name */
  product?: string;

  /** PSU status for the account */
  psu_status?: string;

  /** Credit limit for the account */
  credit_limit?: AmountType;

  /** Whether account holder is of legal age */
  legal_age?: boolean;

  /** Account holder's postal address */
  postal_address?: PostalAddress;
}

/**
 * Balance information
 * https://enablebanking.com/docs/api/reference/#balanceresource
 */
export interface EnableBankingBalance {
  /** Balance name/label */
  name: string;

  /** Balance amount with currency */
  balance_amount: AmountType;

  /** Balance type code */
  balance_type: BalanceStatus;

  /** Reference date for the balance */
  reference_date?: string;

  /** Last change date time (ISO 8601) */
  last_change_date_time?: string;

  /** Last committed transaction reference */
  last_committed_transaction?: string;
}

/**
 * Response from /accounts/{uid}/balances endpoint
 * https://enablebanking.com/docs/api/reference/#halbalances
 * @public
 */
export interface HalBalances {
  /** List of account balances */
  balances: EnableBankingBalance[];
}
