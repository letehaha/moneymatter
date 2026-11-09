import { VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import VentureEvents from '@models/venture/venture-events.model';
import Big from 'big.js';

/** Signed effect of one event on cost basis: calls and fees add, refunds subtract. */
export function costBasisDelta({ event }: { event: Pick<VentureEvents, 'type' | 'grossAmount'> }): Big {
  const gross = new Big(event.grossAmount ? event.grossAmount.toDecimalString(10) : 0);
  switch (event.type) {
    case VENTURE_EVENT_TYPE.capital_call:
    case VENTURE_EVENT_TYPE.fee_payment:
      return gross;
    case VENTURE_EVENT_TYPE.capital_refund:
      return gross.neg();
    case VENTURE_EVENT_TYPE.initial_investment:
    case VENTURE_EVENT_TYPE.distribution:
    case VENTURE_EVENT_TYPE.exit:
    case VENTURE_EVENT_TYPE.nav_update:
    case VENTURE_EVENT_TYPE.writedown:
      return new Big(0);
    default: {
      const unhandled: never = event.type;
      throw new Error(`Unhandled venture event type: ${unhandled}`);
    }
  }
}

/** Cost basis = principal + entryFee + Σ costBasisDelta. */
export function computeCostBasis({
  dealPrincipal,
  dealEntryFee,
  events,
}: {
  dealPrincipal: string;
  dealEntryFee: string;
  events: readonly VentureEvents[];
}): string {
  let basis = new Big(dealPrincipal).plus(dealEntryFee);
  for (const event of events) {
    basis = basis.plus(costBasisDelta({ event }));
  }
  return basis.toFixed(10);
}
