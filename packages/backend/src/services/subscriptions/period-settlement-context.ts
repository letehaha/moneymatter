import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * `markPeriodPaid` in CREATE mode books a transaction that the matching engine then sees
 * too. That transaction already belongs to the period being paid, so the engine must not
 * settle a period for it.
 */
const suppressSettlement = new AsyncLocalStorage<true>();

export const isPeriodSettlementSuppressed = (): boolean => suppressSettlement.getStore() === true;

export const withoutPeriodSettlement = <T>({ run }: { run: () => Promise<T> }): Promise<T> =>
  suppressSettlement.run(true, run);
