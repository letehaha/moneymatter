/** Longest symbol that still reads as a glyph in the monogram; a longer one falls back to the code. */
const MAX_SYMBOL_LENGTH = 2;
const characterCount = ({ text }: { text: string }) => Array.from(text).length;

/**
 * The text of the monogram a custom currency without a logo is drawn with: its symbol when that is
 * one or two characters (₿, Ξ), otherwise its code, cut to the first `maxLength` characters.
 */
export const currencyMonogram = ({
  code,
  symbol,
  maxLength,
}: {
  code: string;
  symbol?: string | null;
  maxLength: number;
}): string => {
  const trimmedSymbol = symbol?.trim() ?? '';
  const text = trimmedSymbol && characterCount({ text: trimmedSymbol }) <= MAX_SYMBOL_LENGTH ? trimmedSymbol : code;

  return Array.from(text).slice(0, maxLength).join('');
};
