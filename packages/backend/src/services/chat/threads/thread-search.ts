/** Words of a query that take part in the message search; the rest are ignored. */
const MAX_SEARCH_TERMS = 8;
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

const SNIPPET_BEFORE_CHARS = 50;
const SNIPPET_AFTER_CHARS = 130;
const SNIPPET_ELLIPSIS = '…';

const escapeRegExp = ({ value }: { value: string }) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractWords = ({ q }: { q: string }): string[] => q.match(WORD_PATTERN) ?? [];

/** `ILIKE` pattern matching the text anywhere in a title; `%`, `_` and `\` in the text match themselves. */
export const buildTitlePattern = ({ q }: { q: string }): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * `to_tsquery` input in which every word of the query is a prefix term and all must match. Words
 * are cut to letters and digits, so no tsquery operator or quote can pass through. Postgres has
 * no prefix form of `websearch_to_tsquery`, hence the explicit `:*`.
 */
export const buildPrefixTsQuery = ({ q }: { q: string }): string | null => {
  const words = extractWords({ q }).slice(0, MAX_SEARCH_TERMS);

  return words.length ? words.map((word) => `${word}:*`).join(' & ') : null;
};

/**
 * Plain text around the first word of the query found in `text`, whitespace collapsed, with an
 * ellipsis at every cut end. A text that holds no match starts from its beginning.
 */
export const buildSnippet = ({ text, q }: { text: string; q: string }): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const words = extractWords({ q });
  const match = words.length
    ? new RegExp(words.map((word) => escapeRegExp({ value: word })).join('|'), 'iu').exec(flat)
    : null;

  const start = match ? Math.max(0, match.index - SNIPPET_BEFORE_CHARS) : 0;
  const end = Math.min(flat.length, (match ? match.index : 0) + SNIPPET_AFTER_CHARS);
  const body = flat.slice(start, end).trim();

  return `${start > 0 ? SNIPPET_ELLIPSIS : ''}${body}${end < flat.length ? SNIPPET_ELLIPSIS : ''}`;
};
