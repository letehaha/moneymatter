import { connection, namespace } from '@models/connection';
import type { Transaction } from 'sequelize';

const isTransactionActive = () => {
  const transaction = namespace.get('transaction');
  // Check both that a transaction exists AND that it hasn't already been
  // committed/rolled back. Stale transactions can remain in the CLS namespace
  // when cls-hooked doesn't perfectly restore async context (e.g. in test
  // environments with supertest where requests share the same process).
  return !!transaction && !transaction.finished;
};

type AsyncFunction<T extends unknown[], R> = (...args: T) => Promise<R>;

export function withTransaction<T extends unknown[], R>(fn: AsyncFunction<T, R>, params = {}): AsyncFunction<T, R> {
  return async (...args: T): Promise<R> => {
    if (isTransactionActive()) {
      return fn(...args);
    } else {
      return connection.sequelize.transaction(async () => {
        return fn(...args);
      }, params);
    }
  };
}

/**
 * Runs `fn` once the surrounding transaction commits, and never when it rolls back; without an open
 * transaction it runs at once and the returned promise settles with it. For effects the database
 * cannot undo, such as deleting a stored file. Sequelize awaits the deferred callback inside
 * `commit()`, so `fn` handles its own failures: it runs after the commit and cannot undo anything.
 */
export async function runAfterCommit({ fn }: { fn: () => Promise<void> | void }): Promise<void> {
  const transaction = namespace.get('transaction') as (Transaction & { finished?: string }) | undefined;

  if (transaction && !transaction.finished) {
    transaction.afterCommit(fn);
  } else {
    await fn();
  }
}
