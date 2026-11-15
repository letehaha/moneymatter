import { CHAT_VISUAL_LIMITS, type ChatEntityRef, type ChatTableCell, type ChatVisualSpec } from '@bt/shared/types';

import { entityKey, lookupEntities } from '../toolkit/entity-ownership';

const isEntityCell = (cell: ChatTableCell): cell is Extract<ChatTableCell, object> =>
  cell !== null && typeof cell === 'object';

/**
 * Gives every entity cell of a validated spec the display name of the row it points at, read from the
 * user's own data. The validator keeps only `{ kind, id }` of a cell, so a `label` here is always the
 * server's: a cell whose entity is missing, belongs to someone else or has no name gets none (and the
 * frontend falls back to the kind), and a `label` already on a cell is dropped before the lookup.
 *
 * `foreign` lists the refs that are not the user's, so a caller can refuse them. Charts and KPI rows
 * hold no entity cells and come back untouched.
 */
export async function resolveEntityLabels({ userId, spec }: { userId: number; spec: ChatVisualSpec }): Promise<{
  spec: ChatVisualSpec;
  foreign: ChatEntityRef[];
}> {
  if (spec.type !== 'table') return { spec, foreign: [] };

  const refs = spec.rows.flatMap((row) =>
    Object.values(row).flatMap((cell) => (isEntityCell(cell) ? [{ kind: cell.kind, id: cell.id }] : [])),
  );
  if (refs.length === 0) return { spec, foreign: [] };

  const { foreign, labels } = await lookupEntities({ userId, refs });

  const rows = spec.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, cell]): [string, ChatTableCell] => {
        if (!isEntityCell(cell)) return [key, cell];

        const label = labels.get(entityKey(cell))?.slice(0, CHAT_VISUAL_LIMITS.textCellMaxChars);

        return [key, label ? { kind: cell.kind, id: cell.id, label } : { kind: cell.kind, id: cell.id }];
      }),
    ),
  );

  return { spec: { ...spec, rows }, foreign };
}
