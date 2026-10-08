export enum API_RESPONSE_STATUS {
  error = 'error',
  success = 'success',
}

export enum API_ERROR_CODES {
  // general
  tooManyRequests = 'TOO_MANY_REQUESTS',
  notFound = 'NOT_FOUND',
  notAllowed = 'NOT_ALLOWED',
  unexpected = 'UNEXPECTED',
  validationError = 'VALIDATION_ERROR',
  conflict = 'CONFLICT',
  categoryHasTransactions = 'CATEGORY_HAS_TRANSACTIONS',
  forbidden = 'FORBIDDEN',
  BadRequest = 'BAD_REQUEST',
  locked = 'LOCKED',
  baseCurrencyChangeInProgress = 'BASE_CURRENCY_CHANGE_IN_PROGRESS',
  baseCurrencyChangeInProgressOtherUser = 'BASE_CURRENCY_CHANGE_IN_PROGRESS_OTHER_USER',
  badGateway = 'BAD_GATEWAY',
  payloadTooLarge = 'PAYLOAD_TOO_LARGE',
  serviceUnavailable = 'SERVICE_UNAVAILABLE',
  planRequired = 'PLAN_REQUIRED',

  // auth
  unauthorized = 'UNAUTHENTICATED',
  invalidCredentials = 'INVALID_CREDENTIALS',
  userExists = 'USER_ALREADY_EXISTS',

  // currencies-related
  currencyProviderUnavailable = 'CURRENCY_PROVIDER_UNAVAILABLE',
  currencyNotConnected = 'CURRENCY_NOT_CONNECTED',

  // investments-related
  cryptoProviderNotConfigured = 'CRYPTO_PROVIDER_NOT_CONFIGURED',

  // sharing-related
  shareCurrencyMismatch = 'SHARE_CURRENCY_MISMATCH',
  baseCurrencyLockedByShares = 'BASE_CURRENCY_LOCKED_BY_SHARES',
  baseCurrencyLockedByHousehold = 'BASE_CURRENCY_LOCKED_BY_HOUSEHOLD',

  // wipe-data
  wipeDataSharingAcknowledgementRequired = 'WIPE_DATA_SHARING_ACK_REQUIRED',

  // loans-related
  loanPaymentOverpayConfirmationRequired = 'LOAN_PAYMENT_OVERPAY_CONFIRMATION_REQUIRED',
}

export enum SORT_DIRECTIONS {
  asc = 'ASC',
  desc = 'DESC',
}

/**
 * Counts returned when re-anchoring account `ref*` balances after a user edits or
 * removes a custom exchange rate. `failed > 0` means some accounts kept a stale
 * base-currency value (no market rate available yet); the daily rate sync
 * re-anchors them later. Surfaced so the client can warn that the refresh lagged.
 */
export interface RefBalanceRemeasureResult {
  updated: number;
  failed: number;
}

/**
 * Per-relationship-kind blocker entry surfaced in `change-base-currency`'s `details`
 * payload. Discriminated by `type` so the frontend renders the right copy and routing for
 * each blocker without re-deriving the shape from the error code.
 */
export type BaseCurrencyBlocker = { type: 'household' | 'share'; count: number };

/**
 * `details` payload of errors with code `currencyNotConnected`. Lists every
 * currency the request needed a conversion for that the user has no
 * UsersCurrencies row for, so the client can point the user at connecting them.
 */
export type CurrencyNotConnectedDetails = { currencyCodes: string[] };

/**
 * `details` payload of a ValidationError with code
 * `loanPaymentOverpayConfirmationRequired`. Amounts are decimals in the loan's currency.
 */
export type LoanPaymentOverpayDetails = {
  /** Projected loan balance after linking the batch (positive = overshoot). */
  projectedBalance: number;
  /** Maximum linkable total without overshooting (equals the current owed balance). */
  maxLinkable: number;
  /** Positive amount by which the batch exceeds the owed balance. */
  overpayBy: number;
};
