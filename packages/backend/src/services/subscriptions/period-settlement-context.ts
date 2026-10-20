import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A transaction `markPeriodPaid` books in CREATE mode already pays its own period; the
 * matcher must not settle another subscription's period with it too.
 */
const suppressSettlement = new AsyncLocalStorage<true>();

export const isPeriodSettlementSuppressed = (): boolean => suppressSettlement.getStore() === true;

export const withoutPeriodSettlement = <T>({ run }: { run: () => Promise<T> }): Promise<T> =>
  suppressSettlement.run(true, run);
