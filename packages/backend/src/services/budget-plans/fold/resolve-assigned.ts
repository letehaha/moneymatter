/**
 * One step of the sparse-row walk, in integer cents: a baseline recurs until
 * the next one, an override lasts a single period.
 */
export const resolveAssigned = ({
  row,
  baseline,
}: {
  row?: { baselineAmount: number | null; overrideAmount: number | null };
  baseline: number;
}): { baseline: number; override: number | null; assigned: number; baselineSet: boolean } => {
  const next = row?.baselineAmount ?? baseline;
  const override = row?.overrideAmount ?? null;

  return { baseline: next, override, assigned: override ?? next, baselineSet: row?.baselineAmount != null };
};
