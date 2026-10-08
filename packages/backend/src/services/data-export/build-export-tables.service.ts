import { logger } from '@js/utils';

import { EXPORT_DOMAINS } from './registry';
import type { ExportBuildInput, ExportFileName, ExportTable } from './types';

interface TransformerFailure {
  file: ExportFileName;
  cause: unknown;
}

function formatFailureMessage({ failures }: { failures: TransformerFailure[] }): string {
  const fileList = failures.map((f) => `"${f.file}"`).join(', ');
  const lead = failures[0]!;
  const leadMsg = lead.cause instanceof Error ? lead.cause.message : String(lead.cause);
  return failures.length === 1
    ? `Data export transformer for ${fileList} failed: ${leadMsg}`
    : `Data export transformers failed (${failures.length}): ${fileList}. First cause: ${leadMsg}`;
}

/**
 * Run every transformer whose output file is in `enabledFiles`. Transformers
 * are wrapped in Promise.allSettled to overlap database round-trips while
 * still surfacing the specific failing transformer (rather than collapsing N
 * concurrent errors into a single generic rejection).
 *
 * One transformer failure aborts the whole export – a partial export would
 * lie about what the user has – but every failure is logged individually so
 * observability sees the full set, not just the first.
 */
export async function buildExportTables({
  userId,
  enabledFiles,
  dateRange,
  accountIds,
}: ExportBuildInput & { enabledFiles: Set<ExportFileName> }): Promise<ExportTable[]> {
  const planned = Object.values(EXPORT_DOMAINS).filter((domain) => enabledFiles.has(domain.name));
  const settled = await Promise.allSettled(
    planned.map(async (domain) => {
      const rows = await domain.build({ userId, dateRange, accountIds });
      return { name: domain.name, rows } as ExportTable;
    }),
  );

  const tables: ExportTable[] = [];
  const failures: TransformerFailure[] = [];
  // Promise.allSettled preserves input order, so index-aligning settled with
  // planned attributes each failure to the right domain without packing
  // metadata into the thrown value.
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      tables.push(outcome.value);
    } else {
      failures.push({ file: planned[index]!.name, cause: outcome.reason });
    }
  });

  if (failures.length) {
    for (const failure of failures) {
      logger.error({
        message: `Data export transformer "${failure.file}" failed for userId=${userId}`,
        error: failure.cause instanceof Error ? failure.cause : new Error(String(failure.cause)),
      });
    }
    throw new Error(formatFailureMessage({ failures }));
  }

  return tables;
}
