/** Longest symbol that still reads as a glyph in the monogram; a longer one falls back to the code. */
const MAX_SYMBOL_LENGTH = 2;
/** Longest code the monogram shows; the circle has no room for more. */
const MAX_CODE_LENGTH = 4;

const characterCount = ({ text }: { text: string }) => Array.from(text).length;

/**
 * The text of the monogram a custom currency without a logo is drawn with: its symbol when that is
 * one or two characters (₿, Ξ), otherwise its code, cut to the first four characters.
 */
export const currencyMonogram = ({ code, symbol }: { code: string; symbol?: string | null }): string => {
  const trimmedSymbol = symbol?.trim() ?? '';

  if (trimmedSymbol && characterCount({ text: trimmedSymbol }) <= MAX_SYMBOL_LENGTH) return trimmedSymbol;

  return Array.from(code).slice(0, MAX_CODE_LENGTH).join('');
};
