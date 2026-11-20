import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { assignmentMinorUnits } from './resolve-assigned';

describe('assignmentMinorUnits', () => {
  it('reads the amounts as minor units at the given decimals', () => {
    const row = {
      baselineAmount: Money.fromDecimal('1.234'),
      overrideAmount: Money.fromDecimal('0.5'),
      carryPolicy: 'floor' as const,
    };

    expect(assignmentMinorUnits({ row, decimals: 3 })).toEqual({
      baselineAmount: 1_234,
      overrideAmount: 500,
      carryPolicy: 'floor',
    });
    expect(assignmentMinorUnits({ row, decimals: 2 })).toEqual({
      baselineAmount: 123,
      overrideAmount: 50,
      carryPolicy: 'floor',
    });
  });

  it('keeps an absent amount null', () => {
    expect(
      assignmentMinorUnits({ row: { baselineAmount: null, overrideAmount: null, carryPolicy: null }, decimals: 0 }),
    ).toEqual({ baselineAmount: null, overrideAmount: null, carryPolicy: null });
  });
});
