import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { ImportJobError } from '@services/import-export/core/queue/import-job-error';
import { normalizePayeeName } from '@services/payees/normalize-name';
import { resolveNormalizedName } from '@services/payees/payee-namespace';
import { createPayee } from '@services/payees/payees.service';

// Mirrors `Payees.name` varchar(200). This resolver runs before the importers'
// per-row try/catch, so a too-long name must fail fast here with a clear
// ValidationError rather than a raw Postgres reject that aborts the batch.
const PAYEE_NAME_MAX_LENGTH = 200;

interface CreatePayeesIfNeededParams {
  userId: number;
  /** Raw merchant strings from the import source (one per row is fine). */
  payeeNames: string[];
}

interface CreatePayeesIfNeededResult {
  /**
   * Resolved Payee id keyed by the VERBATIM source string (not its normalized
   * form) so a per-row caller looks the id up by the value it read from the
   * file. Raw strings that normalize to the same Payee share one id.
   */
  payeeNameToId: Map<string, string>;
  /** Number of Payees actually inserted. Reused/linked Payees don't count. */
  payeesCreated: number;
}

/**
 * Resolve each raw merchant string in `payeeNames` to a Payee id, inserting one
 * where the user's namespace has no match yet.
 *
 * Matching goes through the Payee namespace, not a bare name compare: each raw
 * string is canonicalized via {@link normalizePayeeName} and looked up with
 * {@link resolveNormalizedName}, so it matches an existing Payee by canonical
 * name OR any user-curated alias. A hit reuses it; a miss inserts via
 * {@link createPayee} (which owns namespace-uniqueness + post-commit logo enqueue).
 *
 * Dedup is by normalized form: "Amazon" and "AMAZON " resolve to one Payee,
 * created at most once. Blank / whitespace-only / punctuation-only strings
 * normalize to nothing and are skipped — never mapped, never created.
 *
 * Import-created Payees get no default category and no default tags: categorizing
 * imported rows is the caller's job.
 *
 * No explicit `withTransaction` wrap (mirrors the sibling resolvers): `createPayee`
 * wraps itself and the lookups run through the models, so an ambient import
 * transaction is joined via CLS; otherwise each create runs standalone.
 */
export async function createPayeesIfNeeded({
  userId,
  payeeNames,
}: CreatePayeesIfNeededParams): Promise<CreatePayeesIfNeededResult> {
  const payeeNameToId = new Map<string, string>();
  let payeesCreated = 0;

  // Group raw strings by normalized form, preserving insertion order so the
  // first-seen raw string becomes the created Payee's display name (deterministic).
  const rawsByNormalized = new Map<string, string[]>();
  for (const rawName of payeeNames) {
    if (!rawName.trim()) continue;
    const normalized = normalizePayeeName({ raw: rawName });
    if (!normalized) continue;
    const group = rawsByNormalized.get(normalized);
    if (group) {
      group.push(rawName);
    } else {
      rawsByNormalized.set(normalized, [rawName]);
    }
  }

  for (const [normalized, rawNames] of rawsByNormalized) {
    const hit = await resolveNormalizedName({ userId, normalized });
    let payeeId: string;
    if (hit) {
      payeeId = hit.payeeId;
    } else {
      const displayName = rawNames[0]!.trim();
      if (displayName.length > PAYEE_NAME_MAX_LENGTH) {
        const preview = `${displayName.slice(0, 50)}…`;
        logger.info(`Tried to import too long payee name: ${preview}`);
        const params = { name: preview, length: displayName.length, max: PAYEE_NAME_MAX_LENGTH };
        throw new ImportJobError({
          message: t({ key: 'importExport.payeeNameTooLong', variables: params }),
          failure: { code: 'payee-name-too-long', params },
        });
      }

      try {
        const created = await createPayee({ userId, name: displayName });
        payeeId = created.id;
        payeesCreated += 1;
      } catch (err) {
        // TOCTOU race: a concurrent sync or parallel import may insert this
        // normalizedName between the pre-check and this create, so createPayee
        // throws. Re-resolve: reuse the now-existing row without counting it (we
        // didn't create it); a still-null resolve is a genuine failure — rethrow.
        const raced = await resolveNormalizedName({ userId, normalized });
        if (!raced) throw err;
        payeeId = raced.payeeId;
      }
    }

    // Key by every raw string in the group so a per-row lookup by the verbatim
    // source value resolves regardless of its casing/spacing.
    for (const rawName of rawNames) {
      payeeNameToId.set(rawName, payeeId);
    }
  }

  return { payeeNameToId, payeesCreated };
}
