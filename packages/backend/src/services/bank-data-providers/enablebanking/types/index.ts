/**
 * Enable Banking Types
 * https://enablebanking.com/docs/api/reference/
 *
 * This module re-exports all Enable Banking types organized by domain:
 * - enums: All enumeration types
 * - common: Shared types (AmountType, PostalAddress, etc.)
 * - aspsp: Bank/ASPSP types
 * - accounts: Account and balance types
 * - transactions: Transaction types
 * - auth: Authentication and session types
 * - payments: Payment types
 */

// Enums
export {
  AddressType,
  AuthenticationApproach,
  BalanceStatus,
  CashAccountType,
  ChargeBearerCode,
  CreditDebitIndicator,
  EnvironmentType,
  ExecutionRule,
  FrequencyCode,
  PaymentStatus,
  PaymentType,
  PSUType,
  RateType,
  ReferenceNumberScheme,
  ServiceLevelCode,
  ServiceType,
  TransactionsFetchStrategy,
  TransactionStatus,
  Usage,
} from './enums';

// Common types
export type {
  AmountType,
  BankTransactionCode,
  ClearingSystemMemberIdentification,
  ContactDetails,
  ExchangeRate,
  FinancialInstitutionIdentification,
  GenericIdentification,
  AccountIdentification,
  PartyIdentification,
  PostalAddress,
  ReferenceNumber,
  StatusReasonInformation,
} from './common';

// ASPSP types
export type {
  ASPSP,
  ASPSPData,
  ASPSPGroup,
  ASPSPsResponse,
  AuthCredential,
  AuthMethod,
  PaymentInfo,
  SandboxInfo,
  SandboxUser,
} from './aspsp';

// Account types
export type { EnableBankingAccount, EnableBankingBalance, HalBalances } from './accounts';

// Transaction types
export type { EnableBankingTransaction, HalTransactions, TransactionsQuery } from './transactions';

// Auth types
export type {
  Access,
  CreateSessionRequest,
  CreateSessionResponse,
  EnableBankingConnectionParams,
  EnableBankingCredentials,
  EnableBankingJWTPayload,
  EnableBankingMetadata,
  ErrorResponse,
  GetApplicationResponse,
  GetSessionResponse,
  MetadataAccountSummary,
  OAuthCallbackParams,
  StartAuthorizationRequest,
  StartAuthorizationResponse,
  SuccessResponse,
} from './auth';

// Normalized provider data
export type { DateRange, ProviderBalance, ProviderTransaction } from './provider-data';

// Payment types
export type {
  Beneficiary,
  CreatePaymentRequest,
  CreatePaymentResponse,
  CreditTransferTransaction,
  GetPaymentResponse,
  PaymentIdentification,
  PaymentRequestResource,
  RegulatoryReporting,
} from './payments';
