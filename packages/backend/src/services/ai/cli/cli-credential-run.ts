import { AI_PROVIDER, AICliProvider } from '@bt/shared/types';

import { runWithCliSlot } from './cli-run-limiter';
import { withCodexHome } from './codex-home';

/**
 * Where a CLI credential comes from. `load` returns the decrypted credential plus the `revision`
 * it was read from (the ciphertext); `save` writes a refreshed credential back as a compare-and-swap
 * against that revision and returns the revision it stored, or `null` when the stored credential
 * had changed and was kept.
 */
export interface CliCredentialSource {
  connectionKey: string;
  load: () => Promise<{ credential: string; revision: string }>;
  save?: (params: { credential: string; loadedRevision: string }) => Promise<{ revision: string } | null>;
}

export type CliRunOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * The only way to run a CLI with a stored or session credential. The credential is loaded inside
 * the run and exists in decrypted form only until the call ends.
 *
 * Claude Code: the credential is a static long-lived token, loaded per call and handed to the run
 * as `credential`; nothing is written back and calls of one connection run in parallel.
 *
 * Codex: the run gets `codexHome`, the connection's shared `CODEX_HOME` (see `withCodexHome`), which
 * loads the stored credential when the first run arrives and writes a refreshed one back as runs end.
 * The global slot is released after that write-back and `beforeRelease` finished.
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
  run: (params: { credential?: string; codexHome?: string; signal: AbortSignal }) => Promise<T>;
  beforeRelease?: (params: { outcome: CliRunOutcome<T> }) => Promise<void>;
}): Promise<T> {
  return runWithCliSlot({
    connectionKey: source.connectionKey,
    abortSignal,
    timeoutMs,
    maxWaitMs,
    run: async ({ signal }) => {
      let outcome: CliRunOutcome<T>;

      try {
        const value =
          provider === AI_PROVIDER.codex
            ? await withCodexHome({
                connectionKey: source.connectionKey,
                load: source.load,
                save: source.save,
                run: ({ codexHome }) => run({ codexHome, signal }),
              })
            : await run({ credential: (await source.load()).credential, signal });

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
