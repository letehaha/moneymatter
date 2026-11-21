import { VENTURE_WATERFALL_TYPE } from '@bt/shared/types/venture';
import Big from 'big.js';

const bigMin = (a: Big, b: Big): Big => (a.lt(b) ? a : b);
const bigMax = (a: Big, b: Big | number): Big => {
  const right = typeof b === 'number' ? new Big(b) : b;
  return a.gt(right) ? a : right;
};

/**
 * European waterfall carry computation for a single distribution/exit
 * event. LP-principal-first: GP only earns carry on profit remaining
 * after the LP's full principal has been returned across all prior
 * distributions.
 *
 * Hurdle math is a linear approximation (`principalRemaining * hurdlePct *
 * yearsHeld`). For SK 116 (hurdle=0) this is exact. Real IRR-based
 * waterfalls w/ GP catchup are deferred to v2 — the `waterfallType` param
 * is reserved for that addition.
 *
 * Inputs and outputs are decimal strings (Money-compatible). Computation
 * uses big.js to avoid float drift.
 *
 * @returns `gpCarry` + `lpNet` as DECIMAL(20,10) strings, plus the
 *          `principalReturnedThisEvent` portion so the caller can update
 *          `cumulativeLpPrincipalReturned` for the next event in the chain.
 */
interface ComputeCarryInput {
  /** Gross amount of this distribution/exit event (LP-positive). */
  grossAmount: string;
  /** Cost basis of the deal — principal + entryFee + Σcalls + Σfees − Σrefunds so far. */
  costBasis: string;
  /** Sum of `principalReturnedThisEvent` from all prior distribution/exit events. */
  cumulativeLpPrincipalReturned: string;
  /** Decimal pct (e.g. "0.2" for 20%). */
  carryPct: string;
  /** Decimal pct (e.g. "0" for no hurdle, "0.08" for 8%). */
  hurdlePct: string;
  /** Years between the deal's investmentDate and the event date (fractional ok). */
  yearsHeld: number;
  /** Reserved for v2 American + GP catchup. v1 always uses european. */
  waterfallType?: VENTURE_WATERFALL_TYPE;
}

interface ComputeCarryOutput {
  gpCarryAmount: string;
  lpNetAmount: string;
  principalReturnedThisEvent: string;
  profitThisEvent: string;
  hurdleCredit: string;
}

const ZERO = '0';

export function computeCarry({
  grossAmount,
  costBasis,
  cumulativeLpPrincipalReturned,
  carryPct,
  hurdlePct,
  yearsHeld,
  // waterfallType reserved for v2; only european is implemented today
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  waterfallType = VENTURE_WATERFALL_TYPE.european,
}: ComputeCarryInput): ComputeCarryOutput {
  const gross = new Big(grossAmount);
  if (gross.lte(0)) {
    return {
      gpCarryAmount: ZERO,
      lpNetAmount: ZERO,
      principalReturnedThisEvent: ZERO,
      profitThisEvent: ZERO,
      hurdleCredit: ZERO,
    };
  }

  const carryRate = new Big(carryPct);
  if (carryRate.lte(0)) {
    // Carry rate of zero — LP keeps the full gross.
    return {
      gpCarryAmount: ZERO,
      lpNetAmount: gross.toFixed(10),
      principalReturnedThisEvent: bigMin(
        gross,
        bigMax(new Big(costBasis).minus(cumulativeLpPrincipalReturned), 0),
      ).toFixed(10),
      profitThisEvent: ZERO,
      hurdleCredit: ZERO,
    };
  }

  const basis = new Big(costBasis);
  const returnedSoFar = new Big(cumulativeLpPrincipalReturned);
  const principalRemainingBefore = bigMax(basis.minus(returnedSoFar), 0);

  // European waterfall: LP principal back first, then GP earns carry on profit.
  const principalReturnedThisEvent = bigMin(gross, principalRemainingBefore);
  const profitThisEvent = gross.minus(principalReturnedThisEvent);

  // Simple-hurdle approximation: principalRemaining * hurdlePct * yearsHeld.
  // Acceptable for hurdle=0 (zero credit) — explicit IRR-based waterfalls
  // are reserved for v2.
  const hurdleCredit = principalRemainingBefore.times(hurdlePct).times(Math.max(yearsHeld, 0));

  const carryBeforeHurdle = profitThisEvent.times(carryRate);
  const gpCarry = bigMax(carryBeforeHurdle.minus(hurdleCredit), 0);
  const lpNet = gross.minus(gpCarry);

  return {
    gpCarryAmount: gpCarry.toFixed(10),
    lpNetAmount: lpNet.toFixed(10),
    principalReturnedThisEvent: principalReturnedThisEvent.toFixed(10),
    profitThisEvent: profitThisEvent.toFixed(10),
    hurdleCredit: hurdleCredit.toFixed(10),
  };
}
