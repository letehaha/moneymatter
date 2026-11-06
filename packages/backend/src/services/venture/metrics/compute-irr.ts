import { VENTURE_DEAL_STATUS, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { logger } from '@js/utils/logger';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';
import xirr from 'xirr';

/**
 * IRR via the `xirr` lib. Builds a cash-flow series:
 *   - LP outflows: principal + entryFee at investmentDate, plus
 *     capital_call/fee_payment amounts (negative)
 *   - LP inflows: distribution + exit lpNetAmount (positive)
 *   - Residual NAV: current value at "today" added as a synthetic inflow
 *     while the deal is open (gives a paper IRR; mirrors common LP statement
 *     convention)
 *
 * Returns null on degenerate input (no positive flow, no negative flow,
 * single point, all points on the same day, or xirr lib throws on
 * non-converging series).
 */

const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;

interface CashFlowPoint {
  amount: number;
  when: Date;
}

function buildCashFlowSeries({
  deal,
  events,
  currentValue,
  asOfDate,
}: {
  deal: VentureDeals;
  events: readonly VentureEvents[];
  currentValue: string;
  asOfDate: Date;
}): CashFlowPoint[] {
  const points: CashFlowPoint[] = [];

  // Initial cash-out at investmentDate: principal + entryFee
  const initialOut = Number(deal.principal.toDecimalString(10)) + Number(deal.entryFee.toDecimalString(10));
  if (initialOut > 0) {
    points.push({ amount: -initialOut, when: new Date(deal.investmentDate) });
  }

  for (const event of events) {
    if (event.lpNetAmount === null) continue;
    const lpNet = Number(event.lpNetAmount.toDecimalString(10));
    const when = new Date(event.eventDate);

    switch (event.type) {
      case VENTURE_EVENT_TYPE.capital_call:
      case VENTURE_EVENT_TYPE.fee_payment:
        points.push({ amount: -lpNet, when });
        break;
      case VENTURE_EVENT_TYPE.distribution:
      case VENTURE_EVENT_TYPE.exit:
        points.push({ amount: lpNet, when });
        break;
      default:
      // initial_investment is captured above via deal.principal + entryFee;
      // nav_update + writedown are non-cash and excluded.
    }
  }

  // For open deals, add residual NAV as a synthetic terminal inflow.
  const isClosed = deal.status === VENTURE_DEAL_STATUS.fully_exited || deal.status === VENTURE_DEAL_STATUS.written_off;
  const residual = Number(currentValue);
  if (!isClosed && residual > 0) {
    points.push({ amount: residual, when: asOfDate });
  }

  return points;
}

export function computeIrr({
  deal,
  events,
  currentValue,
  asOfDate = new Date(),
}: {
  deal: VentureDeals;
  events: readonly VentureEvents[];
  currentValue: string;
  asOfDate?: Date;
}): string | null {
  const series = buildCashFlowSeries({ deal, events, currentValue, asOfDate });

  if (series.length < 2) return null;
  const hasPositive = series.some((p) => p.amount > 0);
  const hasNegative = series.some((p) => p.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  // xirr needs a non-zero time span and buckets points into UTC epoch days;
  // a series confined to one such day has no rate to solve for.
  const distinctDays = new Set(series.map((p) => Math.floor(p.when.getTime() / MILLIS_PER_DAY)));
  if (distinctDays.size < 2) return null;

  try {
    const result = xirr(series);
    if (!Number.isFinite(result)) return null;
    return result.toFixed(6);
  } catch (err) {
    // xirr's documented failure modes (no convergence, sign-only series) are
    // surfaced as Errors with specific messages; treat them as "uncomputable"
    // and return null. Anything else is a real bug and we want it visible.
    const message = err instanceof Error ? err.message : String(err);
    const isExpectedConvergenceFailure = /converge/i.test(message);
    if (isExpectedConvergenceFailure) {
      logger.info(`[computeIrr] xirr could not converge (deal=${deal.id}, points=${series.length}): ${message}`);
    } else {
      logger.error(`[computeIrr] unexpected xirr failure (deal=${deal.id}, points=${series.length}): ${message}`);
    }
    return null;
  }
}
