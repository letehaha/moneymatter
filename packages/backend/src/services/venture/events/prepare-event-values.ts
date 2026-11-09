import { VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { getUserBaseCurrencyCode } from '@services/common/transaction-linking';
import Big from 'big.js';

import { computeCarry } from '../metrics/compute-carry';
import {
  CARRY_BEARING_EVENT_TYPES,
  computeCostBasis,
  computeCumulativePrincipalReturnedBefore,
  computeYearsHeld,
} from './event-helpers';

interface PrepareEventValuesInput {
  userId: number;
  deal: VentureDeals;
  type: VENTURE_EVENT_TYPE;
  eventDate: string;
  grossAmount?: string | null;
  navAfter?: string | null;
  quantityPct?: string | null;
  /** Other prior events on the deal, used for carry chain computation. */
  priorEvents: readonly VentureEvents[];
  /** When true, force `lpNetAmount` to the user-provided value (skip auto). */
  lpNetAmountOverride?: string | null;
  /** When true, force `gpCarryAmount` to the user-provided value (skip auto). */
  gpCarryOverride?: string | null;
  /** ID of the event being recomputed (so it is excluded from priorEvents). */
  excludeEventId?: string | null;
}

interface PreparedEventValues {
  grossAmount: string | null;
  gpCarryAmount: string | null;
  lpNetAmount: string | null;
  refAmount: string | null;
  navAfter: string | null;
  quantityPct: string | null;
  lpNetAmountOverridden: boolean;
  gpCarryOverridden: boolean;
  /** Promoted to a dedicated column; null for non-carry events. */
  principalReturnedThisEvent: string | null;
  metaDataExtras: {
    profitThisEvent?: string;
    hurdleCredit?: string;
    carryInputs?: {
      costBasis: string;
      cumulativeLpPrincipalReturned: string;
      carryPct: string;
      hurdlePct: string;
      yearsHeld: number;
    };
  };
}

/**
 * Resolves the canonical values for a venture event given its inputs.
 * Centralises the type-specific branching (carry auto-compute, NAV-only
 * events, overrides) so create, update, and the cascading recompute all
 * stay consistent.
 */
export async function prepareEventValues(input: PrepareEventValuesInput): Promise<PreparedEventValues> {
  const { userId, deal, type, eventDate, priorEvents, excludeEventId } = input;

  // NAV-only events (nav_update, writedown) — exit before resolving ref-currency
  // since they don't produce a refAmount.
  if (type === VENTURE_EVENT_TYPE.nav_update || type === VENTURE_EVENT_TYPE.writedown) {
    if (input.navAfter === null || input.navAfter === undefined) {
      throw new ValidationError({ message: `${type} requires navAfter` });
    }
    return {
      grossAmount: null,
      gpCarryAmount: null,
      lpNetAmount: null,
      refAmount: null,
      navAfter: input.navAfter,
      quantityPct: input.quantityPct ?? null,
      lpNetAmountOverridden: false,
      gpCarryOverridden: false,
      principalReturnedThisEvent: null,
      metaDataExtras: {},
    };
  }

  // Every remaining branch produces a refAmount, so resolve the user's base
  // currency once up-front and reuse.
  const refCurrencyCode = await getUserBaseCurrencyCode({ userId });
  const computeRefAmountFor = (lpNetDecimal: string) =>
    calculateRefAmount({
      amount: Money.fromDecimal(lpNetDecimal),
      baseCode: deal.currencyCode,
      quoteCode: refCurrencyCode,
      userId,
      date: new Date(eventDate),
    });

  // initial_investment — auto from deal.principal + deal.entryFee
  if (type === VENTURE_EVENT_TYPE.initial_investment) {
    const principal = new Big(deal.principal.toDecimalString(10));
    const entryFee = new Big(deal.entryFee.toDecimalString(10));
    const lpNet = principal.plus(entryFee).toFixed(10);

    const refAmount = await computeRefAmountFor(lpNet);

    return {
      grossAmount: lpNet,
      gpCarryAmount: null,
      lpNetAmount: lpNet,
      refAmount: refAmount.toDecimalString(10),
      navAfter: null,
      quantityPct: null,
      lpNetAmountOverridden: false,
      gpCarryOverridden: false,
      principalReturnedThisEvent: null,
      metaDataExtras: {},
    };
  }

  // For all other types, grossAmount is required
  if (input.grossAmount === null || input.grossAmount === undefined) {
    throw new ValidationError({ message: `${type} requires grossAmount` });
  }
  const gross = new Big(input.grossAmount);
  if (gross.lt(0)) {
    throw new ValidationError({ message: 'grossAmount must be non-negative' });
  }

  const filteredPriorEvents = excludeEventId ? priorEvents.filter((e) => e.id !== excludeEventId) : priorEvents;
  const costBasis = computeCostBasis({
    dealPrincipal: deal.principal.toDecimalString(10),
    dealEntryFee: deal.entryFee.toDecimalString(10),
    events: filteredPriorEvents,
  });

  if (type === VENTURE_EVENT_TYPE.capital_refund && (gross.lte(0) || gross.gt(costBasis))) {
    throw new ValidationError({
      message: `capital_refund must be greater than 0 and at most the cost basis (${costBasis})`,
    });
  }

  // Non-carry cash events: lpNetAmount = grossAmount.
  if (!CARRY_BEARING_EVENT_TYPES.includes(type)) {
    const refAmount = await computeRefAmountFor(input.grossAmount);

    return {
      grossAmount: input.grossAmount,
      gpCarryAmount: null,
      lpNetAmount: input.grossAmount,
      refAmount: refAmount.toDecimalString(10),
      navAfter: input.navAfter ?? null,
      quantityPct: input.quantityPct ?? null,
      lpNetAmountOverridden: false,
      gpCarryOverridden: false,
      principalReturnedThisEvent: null,
      metaDataExtras: {},
    };
  }

  // Carry-bearing: distribution + exit
  const cumulativeReturned = computeCumulativePrincipalReturnedBefore({
    events: filteredPriorEvents,
    beforeEvent: { eventDate, id: excludeEventId ?? null },
  });

  const yearsHeld = computeYearsHeld({
    investmentDate: deal.investmentDate,
    eventDate,
  });

  const carryResult = computeCarry({
    grossAmount: input.grossAmount,
    costBasis,
    cumulativeLpPrincipalReturned: cumulativeReturned,
    carryPct: deal.carryPct,
    hurdlePct: deal.hurdlePct,
    yearsHeld,
  });

  // Apply user overrides if provided
  const gpCarryAmount =
    input.gpCarryOverride !== null && input.gpCarryOverride !== undefined
      ? input.gpCarryOverride
      : carryResult.gpCarryAmount;
  const lpNetAmount =
    input.lpNetAmountOverride !== null && input.lpNetAmountOverride !== undefined
      ? input.lpNetAmountOverride
      : carryResult.lpNetAmount;

  const refAmount = await computeRefAmountFor(lpNetAmount);

  return {
    grossAmount: input.grossAmount,
    gpCarryAmount,
    lpNetAmount,
    refAmount: refAmount.toDecimalString(10),
    navAfter: input.navAfter ?? null,
    quantityPct: input.quantityPct ?? null,
    lpNetAmountOverridden: input.lpNetAmountOverride !== null && input.lpNetAmountOverride !== undefined,
    gpCarryOverridden: input.gpCarryOverride !== null && input.gpCarryOverride !== undefined,
    principalReturnedThisEvent: carryResult.principalReturnedThisEvent,
    metaDataExtras: {
      profitThisEvent: carryResult.profitThisEvent,
      hurdleCredit: carryResult.hurdleCredit,
      carryInputs: {
        costBasis,
        cumulativeLpPrincipalReturned: cumulativeReturned,
        carryPct: deal.carryPct,
        hurdlePct: deal.hurdlePct,
        yearsHeld,
      },
    },
  };
}
