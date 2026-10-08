import { applyAutoTagOverride } from '@/common/utils/auto-tag-override';
import { watch, type Ref } from 'vue';

/**
 * Wires a form's tag list to one or more auto-tag sources (payee, category).
 * Applying a source merges its tags into `tagIds`; a later change of the same
 * source swaps only what it auto-applied before (tracked per source), and
 * clearing a source's id retracts its portion. Tags the user picked by hand,
 * and tags another source still supplies, always survive.
 *
 * A suspended source contributes no tags: suspending retracts its portion and
 * resuming hands back exactly what was retracted, or the tags of the last
 * `apply` made while suspended.
 */
export function useAutoTagApply<S extends string>({
  tagIds,
  sources,
  suspended = {},
}: {
  /** Two-way binding to the form's tag list. */
  tagIds: Ref<string[]>;
  /** Getter per source for the form's current id; a falsy id retracts that source's tags. */
  sources: Record<S, () => string | null | undefined>;
  /** Getter per source telling whether the form currently has no use for that source's tags. */
  suspended?: Partial<Record<S, () => boolean>>;
}) {
  const lastAutoApplied = new Map<S, string[]>();
  const heldWhileSuspended = new Map<S, string[]>();

  const swap = ({ source, autoTagIds }: { source: S; autoTagIds: string[] }) => {
    const current = tagIds.value;
    const previousAuto = lastAutoApplied.get(source) ?? [];
    const protectedIds = [...lastAutoApplied].flatMap(([key, ids]) => (key === source ? [] : ids));
    tagIds.value = applyAutoTagOverride({
      currentTagIds: current,
      lastAutoAppliedTagIds: previousAuto,
      autoTagIds,
      protectedTagIds: protectedIds,
    });
    // A tag the user already had stays theirs: only tags this source actually added (or
    // re-supplied, or shares with another source) are retracted on the next change.
    lastAutoApplied.set(
      source,
      autoTagIds.filter((id) => !current.includes(id) || previousAuto.includes(id) || protectedIds.includes(id)),
    );
  };

  const apply = ({ source, autoTagIds }: { source: S; autoTagIds: string[] }) => {
    if (suspended[source]?.()) {
      heldWhileSuspended.set(source, autoTagIds);
      return;
    }
    heldWhileSuspended.delete(source);
    swap({ source, autoTagIds });
  };

  /** Forget every auto-applied set without touching `tagIds`, for form resets that clear the list themselves. */
  const reset = () => {
    lastAutoApplied.clear();
    heldWhileSuspended.clear();
  };

  for (const source of Object.keys(sources) as S[]) {
    watch(sources[source], (id) => {
      if (id) return;
      heldWhileSuspended.delete(source);
      if (!lastAutoApplied.get(source)?.length) return;
      swap({ source, autoTagIds: [] });
    });
  }

  for (const source of Object.keys(suspended) as S[]) {
    watch(suspended[source]!, (isSuspended) => {
      if (isSuspended) {
        const retracted = (lastAutoApplied.get(source) ?? []).filter((id) => tagIds.value.includes(id));
        swap({ source, autoTagIds: [] });
        // An `apply` made since the getter flipped already names what to hand back.
        if (!heldWhileSuspended.has(source)) heldWhileSuspended.set(source, retracted);
        return;
      }
      const held = heldWhileSuspended.get(source);
      heldWhileSuspended.delete(source);
      if (held?.length) swap({ source, autoTagIds: held });
    });
  }

  return { apply, reset };
}
