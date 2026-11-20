import { describe, expect, it } from 'vitest';

import { filterPillClass } from './filter-pill.helpers';

describe('filterPillClass', () => {
  it('uses a fixed 36px pill height with no viewport overrides in both states', () => {
    for (const active of [true, false]) {
      const result = filterPillClass({ active });
      expect(result.split(' ')).toEqual(expect.arrayContaining(['h-9', 'min-h-9']));
      expect(result).not.toContain('md:');
    }
  });

  it('switches border and background by active state', () => {
    const activeClass = filterPillClass({ active: true });
    expect(activeClass).toContain('border-primary/60');
    expect(activeClass).toContain('bg-primary/10');

    const inactiveClass = filterPillClass({ active: false });
    expect(inactiveClass).toContain('border-border');
    expect(inactiveClass).toContain('text-muted-foreground');
  });
});
