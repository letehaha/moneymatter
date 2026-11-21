/**
 * Split a single CSV cell into individual tag names. A row's tags live in one
 * column whose value is comma- or semicolon-delimited; each segment is trimmed and
 * empty segments (from stray, leading, or trailing delimiters) are dropped. Duplicate
 * names are preserved here — deduplication of the resolved tag ids happens when
 * a row's names are mapped to ids during import.
 */
export function splitTagCell(cell: string | undefined | null): string[] {
  if (!cell) return [];
  return cell
    .split(/[,;]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
