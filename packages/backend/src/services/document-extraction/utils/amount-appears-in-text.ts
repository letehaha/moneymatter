const GROUP_SEPARATOR = String.raw`[\s'’.,]`;

/**
 * Whether the text states `amount` as a number of its own, in any grouping or decimal style.
 * ponytail: a group after a space still passes on its own ("234,50" in "1 234,50"), because
 * "*4821 150 000,00" must read as 150000, and 500 passes in "500,000", because "1,250.000" must read
 * as 1250. Non-ASCII digits never match. Tighten if a real miss shows up.
 */
export const amountAppearsInText = ({ amount, text }: { amount: number; text: string }): boolean => {
  const [, integer, fraction] = /^(\d+)(?:\.(\d+))?$/.exec(String(amount)) ?? [];
  if (!integer || amount === 0) return false;

  // Separators may sit anywhere left of the last three digits, which covers 1,234,567 and 12,34,567.
  const grouped =
    Array.from(integer.slice(0, -3), (digit) => `${digit}${GROUP_SEPARATOR}?`).join('') + integer.slice(-3);
  const whole = integer === '0' ? '0?' : grouped;
  const decimals = fraction ? `[.,]${fraction}0*` : '(?:[.,]0+)?';

  return new RegExp(`(?<!\\d[.,'’]?)${whole}${decimals}(?![.,]?\\d)`).test(text);
};
