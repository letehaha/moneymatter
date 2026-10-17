/**
 * Account Serializers
 *
 * Serializes account model instances for API responses.
 * Money fields auto-convert via .toNumber().
 */
import { type AccountApiResponse, BANK_PROVIDER_TYPE, type CurrencyMeta } from '@bt/shared/types';
import { moneyToApiDecimal } from '@common/types/money';
import type Accounts from '@models/accounts.model';
import type { AccountShareContext } from '@services/sharing/get-shared-accounts.service';

import { serializeLogoFields } from './logo-fields.serializer';

// The account wire shape lives in @bt/shared/types so the frontend consumes the
// same source instead of hand-copying it. Re-exported here so existing backend
// importers keep their `accounts.serializer` import path.
export type { AccountApiResponse };

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize an account from DB format to API response
 */
export function serializeAccount(
  account: Accounts & {
    needsRelink?: boolean;
    _shareContext?: AccountShareContext;
    _bankProviderType?: BANK_PROVIDER_TYPE | null;
    currencyMeta?: CurrencyMeta;
  },
): AccountApiResponse {
  // Owner-side bank-link metadata (externalId, externalData, connection FK) leaks PII —
  // IBAN, owner name/address, identification_hash — and owner-internal state to share
  // recipients, who have no use for it. bankProviderType stays so the recipient UI can
  // still render the bank logo.
  const isRecipient = account._shareContext !== undefined && !account._shareContext.isOwner;

  const response: AccountApiResponse = {
    id: account.id,
    name: account.name,
    initialBalance: moneyToApiDecimal(account.initialBalance),
    refInitialBalance: moneyToApiDecimal(account.refInitialBalance),
    currentBalance: moneyToApiDecimal(account.currentBalance),
    refCurrentBalance: moneyToApiDecimal(account.refCurrentBalance),
    creditLimit: moneyToApiDecimal(account.creditLimit),
    refCreditLimit: moneyToApiDecimal(account.refCreditLimit),
    type: account.type,
    accountCategory: account.accountCategory,
    currencyCode: account.currencyCode,
    userId: account.userId,
    externalId: isRecipient ? null : (account.externalId ?? null),
    status: account.status,
    excludeFromStats: account.excludeFromStats,
    bankDataProviderConnectionId: isRecipient ? null : (account.bankDataProviderConnectionId ?? null),
    bankProviderType: account._bankProviderType ?? null,
    ...serializeLogoFields({ entity: account }),
  };

  if (account.currencyMeta) {
    response.currencyMeta = account.currencyMeta;
  }

  if (account.needsRelink !== undefined) {
    response.needsRelink = account.needsRelink;
  }

  if (account._shareContext) {
    response.share = {
      isOwner: account._shareContext.isOwner,
      owner: account._shareContext.owner,
      permission: account._shareContext.permission,
      policy: account._shareContext.policy,
      accessSource: account._shareContext.accessSource,
    };
  }

  return response;
}

/**
 * Serialize multiple accounts
 */
export function serializeAccounts(
  accounts: (Accounts & {
    needsRelink?: boolean;
    _shareContext?: AccountShareContext;
    _bankProviderType?: BANK_PROVIDER_TYPE | null;
    currencyMeta?: CurrencyMeta;
  })[],
): AccountApiResponse[] {
  return accounts.map(serializeAccount);
}
