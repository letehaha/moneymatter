/**
 * Recompute a form's tag selection when an auto-tag source (payee, category)
 * changes.
 *
 * The form keeps no per-tag provenance: whatever this source auto-applied last
 * time is remembered by the caller in `lastAutoAppliedTagIds`; everything else
 * in the current selection counts as the user's manual picks. A source change
 * swaps its auto portion wholesale (a source with no tag rule simply clears it)
 * while manual picks survive and are merged with the new auto tags.
 * `protectedTagIds` are tags another source still supplies; they are kept
 * even when this source stops supplying them.
 */
export function applyAutoTagOverride({
  currentTagIds,
  lastAutoAppliedTagIds,
  autoTagIds,
  protectedTagIds = [],
}: {
  currentTagIds: string[];
  lastAutoAppliedTagIds: string[];
  autoTagIds: string[];
  protectedTagIds?: string[];
}): string[] {
  const previousAuto = new Set(lastAutoAppliedTagIds);
  const protectedSet = new Set(protectedTagIds);
  const manual = currentTagIds.filter((id) => !previousAuto.has(id) || protectedSet.has(id));
  const manualSet = new Set(manual);
  return [...manual, ...autoTagIds.filter((id) => !manualSet.has(id))];
}
