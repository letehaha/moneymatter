/**
 * Outstanding debt magnitude of a signed loan balance. Loan balances follow the
 * liability convention (negative while debt is owed), so only a negative value
 * represents debt: `-200 → 200`. A zero or positive balance carries no debt and
 * contributes `0` — unlike `Math.abs`, which would misread a positive (credit)
 * balance as outstanding debt.
 */
export const outstandingAmount = ({ balance }: { balance: number }): number => Math.max(0, -balance);
