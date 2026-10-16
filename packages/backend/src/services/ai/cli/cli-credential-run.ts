import { AI_PROVIDER, AICliProvider } from '@bt/shared/types';
import { logger } from '@js/utils/logger';

import { runWithCliSlot } from './cli-run-limiter';
import { withCodexHome } from './codex-home';

/**
 * Where a CLI credential comes from. `load` returns the decrypted credential plus the `revision`
 * it was read from (the ciphertext); `save` writes a refreshed credential back as a compare-and-swap
 * against that revision.
 */
export interface CliCredentialSource {
  connectionKey: string;
  load: () => Promise<{ credential: string; revision: string }>;
  save?: (params: { credential: string; loadedRevision: string }) => Promise<void>;
}

export type CliRunOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * The only way to run a CLI with a stored or session credential. The credential is loaded after the
 * slot is held (so a run queued behind one that refreshed Codex tokens sees the refreshed ones) and
 * exists in decrypted form only until this call ends. The slot is released after the refresh
 * write-back and `beforeRelease` finished.
 */
export async function runWithCliCredential<T>({
  provider,
  source,
  abortSignal,
  timeoutMs,
  maxWaitMs,
  run,
  beforeRelease,
}: {
  provider: AICliProvider;
  source: CliCredentialSource;
  abortSignal?: AbortSignal;
  timeoutMs: number;
  maxWaitMs?: number;
  run: (params: { credential: string; codexHome?: string; signal: AbortSignal }) => Promise<T>;
  beforeRelease?: (params: { outcome: CliRunOutcome<T> }) => Promise<void>;
}): Promise<T> {
  return runWithCliSlot({
    connectionKey: source.connectionKey,
    abortSignal,
    timeoutMs,
    maxWaitMs,
    run: async ({ signal }) => {
      const { credential, revision } = await source.load();

      const persistRefreshed = async ({ authJson }: { authJson: string }) => {
        if (!source.save) return;

        try {
          await source.save({ credential: authJson, loadedRevision: revision });
        } catch (error) {
          logger.error('Failed to persist a refreshed CLI credential', {
            connectionKey: source.connectionKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      let outcome: CliRunOutcome<T>;

      try {
        const value =
          provider === AI_PROVIDER.codex
            ? await withCodexHome({
                authJson: credential,
                onRefreshed: persistRefreshed,
                run: ({ codexHome }) => run({ credential, codexHome, signal }),
              })
            : await run({ credential, signal });

        outcome = { ok: true, value };
      } catch (error) {
        outcome = { ok: false, error };
      }

      if (beforeRelease) {
        try {
          await beforeRelease({ outcome });
        } catch (error) {
          if (outcome.ok) outcome = { ok: false, error };
        }
      }

      if (!outcome.ok) throw outcome.error;

      return outcome.value;
    },
  });
}
