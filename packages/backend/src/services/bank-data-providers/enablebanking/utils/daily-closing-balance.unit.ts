import { type ClosingBalanceRow, findClosingRowId } from './daily-closing-balance';

/** Builds a ladder from a starting balance and signed amounts, in decimal units. */
function ladder({ start, amounts }: { start: number; amounts: number[] }): ClosingBalanceRow[] {
  let running = Math.round(start * 100);
  return amounts.map((amount, index) => {
    const deltaMinorUnits = Math.round(amount * 100);
    running += deltaMinorUnits;
    return { id: `tx${index}`, balanceAfterMinorUnits: running, deltaMinorUnits };
  });
}

describe('findClosingRowId', () => {
  it('returns null for an empty day', () => {
    expect(findClosingRowId({ rows: [] })).toBeNull();
  });

  it('returns the only row of a single-transaction day', () => {
    const rows = ladder({ start: 500, amounts: [-120.5] });
    expect(findClosingRowId({ rows })).toBe('tx0');
  });

  it('finds the closing row of a descending ladder', () => {
    const rows = ladder({ start: 5000, amounts: [-1000, -2000, -2050] });
    expect(findClosingRowId({ rows })).toBe('tx2');
  });

  it('finds the closing row of a mixed income and expense ladder', () => {
    const rows = ladder({ start: 7900.28, amounts: [-19.8, -8.28, -47, -38, -20.76, 300.5] });
    expect(findClosingRowId({ rows })).toBe('tx5');
  });

  it('is independent of the order rows arrive in', () => {
    const rows = ladder({ start: 5000, amounts: [-1000, -2000, -2050] });
    const reversed = [...rows].reverse();
    const shuffled = [rows[1]!, rows[2]!, rows[0]!];

    expect(findClosingRowId({ rows: reversed })).toBe('tx2');
    expect(findClosingRowId({ rows: shuffled })).toBe('tx2');
  });

  it('bails when the day arrived in two disconnected pieces', () => {
    const first = ladder({ start: 2323.54, amounts: [-215.32] });
    const second = ladder({ start: 888.18, amounts: [153.98] }).map((row) => ({ ...row, id: `${row.id}-b` }));

    expect(findClosingRowId({ rows: [...first, ...second] })).toBeNull();
  });

  it('bails when two rows sit on the same balance', () => {
    const rows: ClosingBalanceRow[] = [
      { id: 'a', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
      { id: 'b', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
    ];

    expect(findClosingRowId({ rows })).toBeNull();
  });

  it('bails on a ladder that loops back onto itself', () => {
    const rows: ClosingBalanceRow[] = [
      { id: 'a', balanceAfterMinorUnits: 100_000, deltaMinorUnits: 50_000 },
      { id: 'b', balanceAfterMinorUnits: 50_000, deltaMinorUnits: -50_000 },
    ];

    expect(findClosingRowId({ rows })).toBeNull();
  });

  it('bails when a rung is missing and the day nets back to an earlier balance', () => {
    // 1000 → 900 (r0) → 850 (r1) → [820, no balance stamped] → 900 (r3). Dropping
    // the unstamped row leaves r1 as the only unchallenged candidate, but the day
    // closed at 900, not 850.
    const rows: ClosingBalanceRow[] = [
      { id: 'r0', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
      { id: 'r1', balanceAfterMinorUnits: 85_000, deltaMinorUnits: -5_000 },
      { id: 'r3', balanceAfterMinorUnits: 90_000, deltaMinorUnits: 8_000 },
    ];

    expect(findClosingRowId({ rows })).toBeNull();
  });

  it('bails when a rung is missing from the middle of a straight ladder', () => {
    const rows: ClosingBalanceRow[] = [
      { id: 'r0', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
      { id: 'r2', balanceAfterMinorUnits: 70_000, deltaMinorUnits: -10_000 },
    ];

    expect(findClosingRowId({ rows })).toBeNull();
  });

  it('bails on a complete day that returns to an earlier balance', () => {
    // 1000 → 900 → 950 → 900 → 890, an equal-and-opposite pair mid-day. Only one
    // chain covers all four rows, so this is resolvable in principle, but the walk
    // cannot tell which of the two 900.00 rows precedes the close and refuses
    // rather than pick. Deliberate: across six months of production this shape
    // never occurs, and resolving it would need a backtracking search.
    const rows: ClosingBalanceRow[] = [
      { id: 'a', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
      { id: 'b', balanceAfterMinorUnits: 95_000, deltaMinorUnits: 5_000 },
      { id: 'c', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -5_000 },
      { id: 'd', balanceAfterMinorUnits: 89_000, deltaMinorUnits: -1_000 },
    ];

    expect(findClosingRowId({ rows })).toBeNull();
  });

  it('puts a zero-amount row last, since it can only ever follow', () => {
    const rows: ClosingBalanceRow[] = [
      { id: 'a', balanceAfterMinorUnits: 90_000, deltaMinorUnits: -10_000 },
      { id: 'void', balanceAfterMinorUnits: 90_000, deltaMinorUnits: 0 },
    ];

    expect(findClosingRowId({ rows })).toBe('void');
  });
});
