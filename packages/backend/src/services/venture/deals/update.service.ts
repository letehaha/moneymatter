import { type NonImageLogoPayload, RecordId } from '@bt/shared/types';
import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE } from '@bt/shared/types/venture';
import { roundMoneyValues } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { applyManualLogoPatch } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';
import Big from 'big.js';

import { findVentureDealOrThrow } from '../helpers';

interface UpdateVentureDealParams extends NonImageLogoPayload {
  userId: number;
  dealId: string;
  name?: string;
  platformId?: string | null;
  spvSubtype?: VENTURE_SPV_SUBTYPE | null;
  targetCompany?: string | null;
  currencyCode?: string;
  status?: VENTURE_DEAL_STATUS;
  principal?: string;
  entryFee?: string;
  entryFeePct?: string;
  mgmtFeePct?: string;
  carryPct?: string;
  hurdlePct?: string;
  investmentDate?: string;
  expectedExitDate?: string | null;
  notes?: string | null;
}

const isDecimalChanged = ({ next, stored, scale }: { next?: string; stored: string; scale: number }) =>
  next !== undefined && !new Big(next).round(scale).eq(stored);

const updateVentureDealImpl = async (params: UpdateVentureDealParams) => {
  const { userId, dealId } = params;

  const deal = await findVentureDealOrThrow({ id: dealId, userId });

  if (params.currencyCode !== undefined) {
    await findOrThrowNotFound({
      query: Currencies.findOne({ where: { code: params.currencyCode } }),
      message: 'Currency not found',
    });
  }

  if (params.platformId !== undefined && params.platformId !== null) {
    await findOrThrowNotFound({
      query: VenturePlatforms.findOne({ where: { id: params.platformId, userId } }),
      message: 'Venture platform not found',
    });
  }

  if (params.principal !== undefined && new Big(params.principal).lt(0)) {
    throw new ValidationError({ message: 'Principal must be non-negative' });
  }

  const rounded = await roundMoneyValues({
    values: {
      principal: params.principal !== undefined ? Money.fromDecimal(params.principal) : undefined,
      entryFee: params.entryFee !== undefined ? Money.fromDecimal(params.entryFee) : undefined,
      storedPrincipal: params.principal !== undefined ? deal.principal : undefined,
      storedEntryFee: params.entryFee !== undefined ? deal.entryFee : undefined,
    },
    userId,
    currencyCode: params.currencyCode ?? deal.currencyCode,
    mode: 'half-up',
  });

  // Terms feed per-event cost-basis / carry math and currency changes would orphan
  // link rows, so they lock once events exist. Clients resend the whole form, so
  // only a value that differs from the stored one (both rounded to the currency) counts.
  const attemptedTermsChange =
    isDecimalChanged({
      next: rounded.principal?.toDecimalString(10),
      stored: (rounded.storedPrincipal ?? deal.principal).toDecimalString(10),
      scale: 10,
    }) ||
    isDecimalChanged({
      next: rounded.entryFee?.toDecimalString(10),
      stored: (rounded.storedEntryFee ?? deal.entryFee).toDecimalString(10),
      scale: 10,
    }) ||
    isDecimalChanged({ next: params.entryFeePct, stored: deal.entryFeePct, scale: 6 }) ||
    isDecimalChanged({ next: params.carryPct, stored: deal.carryPct, scale: 6 }) ||
    isDecimalChanged({ next: params.hurdlePct, stored: deal.hurdlePct, scale: 6 }) ||
    (params.investmentDate !== undefined && params.investmentDate !== deal.investmentDate) ||
    (params.currencyCode !== undefined && params.currencyCode !== deal.currencyCode);
  if (attemptedTermsChange) {
    const eventCount = await VentureEvents.count({ where: { dealId } });
    if (eventCount > 0) {
      throw new ValidationError({
        message:
          'Cannot change deal terms (principal, entryFee, carryPct, hurdlePct, investmentDate, currencyCode) once events exist. Delete the events first.',
      });
    }
  }

  const updates: Partial<VentureDeals> = {};
  if (params.name !== undefined) updates.name = params.name.trim();
  if (params.platformId !== undefined) updates.platformId = params.platformId as RecordId | null;
  if (params.spvSubtype !== undefined) updates.spvSubtype = params.spvSubtype;
  if (params.targetCompany !== undefined) updates.targetCompany = params.targetCompany;
  if (params.currencyCode !== undefined) updates.currencyCode = params.currencyCode;
  if (params.status !== undefined) updates.status = params.status;
  if (rounded.principal !== undefined) updates.principal = rounded.principal;
  if (rounded.entryFee !== undefined) updates.entryFee = rounded.entryFee;
  if (params.entryFeePct !== undefined) updates.entryFeePct = params.entryFeePct;
  if (params.mgmtFeePct !== undefined) updates.mgmtFeePct = params.mgmtFeePct;
  if (params.carryPct !== undefined) updates.carryPct = params.carryPct;
  if (params.hurdlePct !== undefined) updates.hurdlePct = params.hurdlePct;
  if (params.investmentDate !== undefined) updates.investmentDate = params.investmentDate;
  if (params.expectedExitDate !== undefined) updates.expectedExitDate = params.expectedExitDate;
  if (params.notes !== undefined) updates.notes = params.notes;

  const logoPatch = applyManualLogoPatch({
    patch: {
      logoDomain: params.logoDomain,
      logoInitials: params.logoInitials,
      logoColor: params.logoColor,
      logoIcon: params.logoIcon,
    },
    stored: deal,
  });

  await deal.update({ ...updates, ...logoPatch });

  return deal.reload({
    include: [
      { model: VenturePlatforms, as: 'platform' },
      { model: Currencies, as: 'currency' },
    ],
  });
};

export const updateVentureDeal = withTransaction(updateVentureDealImpl);
