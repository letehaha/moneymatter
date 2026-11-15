import { CHAT_READ_RESULT_MAX_CHARS } from '@bt/shared/types';

import type { ChatToolResult } from './types';

export const toolSuccess = ({ text, summary }: { text: string; summary?: string }): ChatToolResult => ({
  isError: false,
  text,
  ...(summary === undefined ? {} : { summary }),
});

export const toolFailure = ({ text }: { text: string }): ChatToolResult => ({ isError: true, text });

export const errorMessage = ({ error }: { error: unknown }): string =>
  error instanceof Error ? error.message : String(error);

/** Keeps what the model reads within the cap; the note tells it the rest exists and how to reach it. */
export function capForModel({ text }: { text: string }): string {
  if (text.length <= CHAT_READ_RESULT_MAX_CHARS) return text;

  const note = `\n[truncated: showing the first characters of ${text.length}. Narrow the query or page through the results.]`;
  return `${text.slice(0, CHAT_READ_RESULT_MAX_CHARS - note.length)}${note}`;
}

/** Arguments kept on a source or a record: whole when small, a cut copy when large. */
export function compactArgs({ args }: { args: unknown }): unknown {
  const json = JSON.stringify(args ?? {});
  return json.length <= 1_000 ? (args ?? {}) : { truncated: json.slice(0, 500) };
}

/**
 * A JSON result without its indentation. The catalog tools pretty-print for the external MCP clients; the
 * model reads the same data for a fraction of the tokens when it is compact. Text that is not one JSON
 * value stays as it is.
 */
export function compactJsonText({ text }: { text: string }): string {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed) : text;
  } catch {
    return text;
  }
}
