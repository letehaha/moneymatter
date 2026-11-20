/** One booked row's place in a booking day's balance ladder, in the account currency's minor units. */
export interface ClosingBalanceRow {
  id: string;
  balanceAfterMinorUnits: number;
  deltaMinorUnits: number;
}

/**
 * Which row of a booking day carries the day's closing balance.
 *
 * `balance_after_transaction` is a running balance, so within a day every row
 * except the last is some other row's starting point: `after(next) - amount(next)`
 * lands back on it. The closing row is the one nothing continues from. Nothing
 * else in the payload identifies it – the rows share a date-only booking date and
 * arrive in no guaranteed order.
 *
 * Returns null when the day's rows do not resolve to exactly one such row, which
 * happens when the day was fetched in pieces or two rows sit on the same balance.
 * Callers must then leave the day's stored balance alone rather than guess.
 */
export function findClosingRowId({ rows }: { rows: ClosingBalanceRow[] }): string | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!.id;

  const closingRows = rows.filter(
    (candidate) =>
      !rows.some(
        (other) =>
          other.id !== candidate.id &&
          other.balanceAfterMinorUnits - other.deltaMinorUnits === candidate.balanceAfterMinorUnits,
      ),
  );

  if (closingRows.length !== 1) return null;

  const closingRow = closingRows[0]!;
  return walksBackOverEveryRow({ rows, closingRow }) ? closingRow.id : null;
}

/**
 * Whether stepping back from `closingRow` through `balanceAfter - amount` reaches
 * every row of the day exactly once.
 *
 * A day missing a rung can still leave a single unchallenged candidate, because
 * the row that would have ruled it out is the one that went missing – and that
 * candidate is then a mid-day row, whose balance is not the day's close. Refusing
 * anything short of a whole chain is what keeps a partial day from being written
 * as if it were certain.
 */
function walksBackOverEveryRow({
  rows,
  closingRow,
}: {
  rows: ClosingBalanceRow[];
  closingRow: ClosingBalanceRow;
}): boolean {
  const visited = new Set<string>([closingRow.id]);
  let current = closingRow;

  for (;;) {
    const previousBalance = current.balanceAfterMinorUnits - current.deltaMinorUnits;
    const predecessors = rows.filter((row) => !visited.has(row.id) && row.balanceAfterMinorUnits === previousBalance);

    if (predecessors.length !== 1) {
      return predecessors.length === 0 && visited.size === rows.length;
    }

    current = predecessors[0]!;
    visited.add(current.id);
  }
}
