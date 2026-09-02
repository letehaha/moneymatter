import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  DEFAULT_ANNUAL_APPRECIATION_RATE_PCT,
  PROPERTY_TYPE,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import Accounts, { createAccount as createAccountInDb } from '@models/accounts.model';
import Properties from '@models/properties.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { parseISO } from 'date-fns';

import { computePropertyValue } from './compute-property-value';
import { assertLinkableLoanAccount } from './helpers';

interface CreatePropertyParams {
  userId: number;
  name: string;
  currencyCode: string;
  address: string;
  city?: string | null;
  country?: string | null;
  propertyType: PROPERTY_TYPE;
  yearBuilt?: number | null;
  notes?: string | null;
  purchasePrice: Money;
  purchaseDate: string;
  annualAppreciationRatePct?: number;
  loanAccountId?: string | null;
}

const createPropertyImpl = async (params: CreatePropertyParams) => {
  const {
    userId,
    name,
    currencyCode,
    address,
    city = null,
    country = null,
    propertyType,
    yearBuilt = null,
    notes = null,
    purchasePrice,
    purchaseDate,
    annualAppreciationRatePct = DEFAULT_ANNUAL_APPRECIATION_RATE_PCT,
    loanAccountId = null,
  } = params;

  await ensureUserCurrencyConnected({ userId, currencyCode });
  await assertLinkableLoanAccount({ userId, loanAccountId });

  const now = new Date();

  // Compute today's projected value — that becomes the account's initial
  // balance. Historical Balances rows are not backfilled, matching vehicles.
  const currentValue = computePropertyValue({
    anchorValue: purchasePrice,
    anchorDate: parseISO(purchaseDate),
    asOf: now,
    annualRatePct: annualAppreciationRatePct,
  });

  const refCurrentValue = await calculateRefAmount({
    userId,
    amount: currentValue,
    baseCode: currencyCode,
    date: now,
  });

  const zero = Money.zero();

  const account = await createAccountInDb({
    userId,
    name,
    currencyCode,
    accountCategory: ACCOUNT_CATEGORIES.property,
    type: ACCOUNT_TYPES.system,
    initialBalance: currentValue,
    refInitialBalance: refCurrentValue,
    creditLimit: zero,
    refCreditLimit: zero,
  });

  if (!account) {
    throw new ValidationError({ message: 'Failed to create property account' });
  }

  const property = await Properties.create({
    accountId: account.id,
    userId,
    loanAccountId,
    address,
    city,
    country,
    propertyType,
    yearBuilt,
    notes,
    purchasePrice,
    purchaseDate,
    annualAppreciationRatePct,
    valueLastComputedAt: now,
  });

  return Properties.findByPk(property.id, {
    include: [{ model: Accounts, as: 'account' }],
  });
};

export const createProperty = withTransaction(createPropertyImpl);
