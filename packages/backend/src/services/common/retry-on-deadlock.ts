import { sleep } from '@common/helpers';
import { namespace } from '@models/connection';
import { DatabaseError } from 'sequelize';

const PG_DEADLOCK_DETECTED = '40P01';

export const isDeadlockError = (error: unknown): boolean =>
  error instanceof DatabaseError && (error.parent as { code?: string } | undefined)?.code === PG_DEADLOCK_DETECTED;

/**
 * Run `fn` again once when Postgres picks it as a deadlock victim. The victim's transaction
 * is rolled back and its locks released, so the retry runs after the winner commits. Inside
 * an outer transaction there is nothing to retry: that transaction is aborted.
 */
export async function retryOnDeadlock<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const ambient = namespace.get('transaction');
    if (!isDeadlockError(error) || (ambient && !ambient.finished)) throw error;
    await sleep({ ms: 500 + Math.random() * 1500 });
    return fn();
  }
}
