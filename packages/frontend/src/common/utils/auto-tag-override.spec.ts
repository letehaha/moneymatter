import { describe, expect, it } from 'vitest';

import { applyAutoTagOverride } from './auto-tag-override';

describe('applyAutoTagOverride', () => {
  it('applies auto tags onto an empty selection', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: [],
        lastAutoAppliedTagIds: [],
        autoTagIds: ['a', 'b'],
      }),
    ).toEqual(['a', 'b']);
  });

  it('replaces previously auto-applied tags when the source changes', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['a', 'b'],
        lastAutoAppliedTagIds: ['a', 'b'],
        autoTagIds: ['c'],
      }),
    ).toEqual(['c']);
  });

  it('keeps manually picked tags across source changes', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['manual', 'a'],
        lastAutoAppliedTagIds: ['a'],
        autoTagIds: ['b'],
      }),
    ).toEqual(['manual', 'b']);
  });

  it('clears only the auto portion when the new source has no tag rule', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['manual', 'a', 'b'],
        lastAutoAppliedTagIds: ['a', 'b'],
        autoTagIds: [],
      }),
    ).toEqual(['manual']);
  });

  it('does not resurrect an auto tag the user deselected', () => {
    // User deselected 'b' (still tracked as auto) — switching sources must not
    // treat its absence as a manual pick.
    expect(
      applyAutoTagOverride({
        currentTagIds: ['a'],
        lastAutoAppliedTagIds: ['a', 'b'],
        autoTagIds: ['c'],
      }),
    ).toEqual(['c']);
  });

  it('deduplicates when an auto tag is already manually selected', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['a'],
        lastAutoAppliedTagIds: [],
        autoTagIds: ['a', 'b'],
      }),
    ).toEqual(['a', 'b']);
  });

  it('treats saved tags as manual in edit mode (empty tracker merges only)', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['saved1', 'saved2'],
        lastAutoAppliedTagIds: [],
        autoTagIds: ['p1'],
      }),
    ).toEqual(['saved1', 'saved2', 'p1']);
  });

  it('keeps a retracted auto tag that another source still supplies', () => {
    expect(
      applyAutoTagOverride({
        currentTagIds: ['shared', 'a'],
        lastAutoAppliedTagIds: ['shared', 'a'],
        autoTagIds: ['c'],
        protectedTagIds: ['shared'],
      }),
    ).toEqual(['shared', 'c']);
  });
});
