import { namespace } from '@models/connection';
import type { Transaction } from 'sequelize';

/**
 * Runs `fn` once the ambient CLS transaction commits, or right away when none is
 * active. A rolled-back transaction never runs it.
 *
 * ponytail: Sequelize 6 also fires afterCommit hooks when COMMIT itself fails (it sets
 * `finished = 'commit'` in a `finally`), and nothing on the transaction tells the two apart.
 */
export const runAfterCommit = async ({ fn }: { fn: () => unknown }): Promise<void> => {
  // `finished` isn't on the public Transaction type; `withTransaction` reads it the same way.
  const transaction = namespace.get('transaction') as (Transaction & { finished?: string }) | undefined;
  if (transaction && !transaction.finished) {
    transaction.afterCommit(async () => {
      await fn();
    });
    return;
  }
  await fn();
};
