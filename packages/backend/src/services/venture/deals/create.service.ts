import {
  VENTURE_CASH_FLOW_MODE,
  VENTURE_DEAL_STATUS,
  VENTURE_EVENT_TYPE,
  VENTURE_SPV_SUBTYPE,
  VENTURE_VEHICLE_TYPE,
} from '@bt/shared/types/venture';
import { roundMoneyValues } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { withTransaction } from '@services/common/with-transaction';
import Big from 'big.js';

import { createVentureEvent } from '../events/create.service';

interface InitialInvestmentInput {
  cashFlowMode: VENTURE_CASH_FLOW_MODE;
  transactionIds?: string[];
}

interface CreateVentureDealParams {
  userId: number;
  name: string;
  currencyCode: string;
  principal: string;
  investmentDate: string;
  platformId?: string | null;
  vehicleType?: VENTURE_VEHICLE_TYPE;
  spvSubtype?: VENTURE_SPV_SUBTYPE | null;
  targetCompany?: string | null;
  entryFeePct?: string;
  entryFee?: string;
  mgmtFeePct?: string;
  carryPct?: string;
  hurdlePct?: string;
  expectedExitDate?: string | null;
  notes?: string | null;
  /**
   * Optional: auto-create the `initial_investment` event alongside the deal
   * in the same DB transaction (all-or-none). If omitted, the caller can
   * POST it later via /events.
   */
  initialInvestment?: InitialInvestmentInput;
}

const createVentureDealImpl = async (params: CreateVentureDealParams) => {
  const {
    userId,
    name,
    currencyCode,
    principal,
    investmentDate,
    platformId = null,
    vehicleType = VENTURE_VEHICLE_TYPE.spv,
    spvSubtype = null,
    targetCompany = null,
    expectedExitDate = null,
    notes = null,
  } = params;

  await findOrThrowNotFound({
    query: Currencies.findOne({ where: { code: currencyCode } }),
    message: 'Currency not found',
  });

  let platform: VenturePlatforms | null = null;
  if (platformId) {
    platform = await findOrThrowNotFound({
      query: VenturePlatforms.findOne({ where: { id: platformId, userId } }),
      message: 'Venture platform not found',
    });
  }

  // Snapshot fee pcts from platform defaults unless explicitly overridden.
  const entryFeePct = params.entryFeePct ?? platform?.defaultEntryFeePct ?? '0';
  const mgmtFeePct = params.mgmtFeePct ?? platform?.defaultMgmtFeePct ?? '0';
  const carryPct = params.carryPct ?? platform?.defaultCarryPct ?? '0';
  const hurdlePct = params.hurdlePct ?? platform?.defaultHurdlePct ?? '0';

  if (new Big(principal).lt(0)) {
    throw new ValidationError({ message: 'Principal must be non-negative' });
  }

  const rounded = await roundMoneyValues({
    values: {
      principal: Money.fromDecimal(principal),
      entryFee: Money.fromDecimal(params.entryFee ?? new Big(principal).times(entryFeePct).toString()),
    },
    userId,
    currencyCode,
    mode: 'half-up',
  });

  const deal = await VentureDeals.create({
    userId,
    platformId,
    name: name.trim(),
    vehicleType,
    spvSubtype,
    targetCompany,
    currencyCode,
    status: VENTURE_DEAL_STATUS.outstanding,
    principal: rounded.principal,
    entryFee: rounded.entryFee,
    entryFeePct,
    mgmtFeePct,
    carryPct,
    hurdlePct,
    investmentDate,
    expectedExitDate,
    notes,
  });

  if (params.initialInvestment) {
    await createVentureEvent({
      userId,
      dealId: deal.id,
      type: VENTURE_EVENT_TYPE.initial_investment,
      eventDate: investmentDate,
      cashFlowMode: params.initialInvestment.cashFlowMode,
      transactionIds: params.initialInvestment.transactionIds ?? [],
    });
  }

  return deal.reload({
    include: [{ model: VenturePlatforms, as: 'platform' }],
  });
};

export const createVentureDeal = withTransaction(createVentureDealImpl);
