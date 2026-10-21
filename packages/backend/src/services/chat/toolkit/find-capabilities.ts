import { CHAT_READ_RESULT_MAX_CHARS } from '@bt/shared/types';
import { z } from 'zod';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';
import { CHAT_EXCLUDED_TOOLS } from '../policies/excluded';
import { getModelSchema } from './model-schema';
import { defineNativeTool } from './native-tool';
import { toolSuccess } from './result-text';
import type { ChatToolContext } from './types';

const DEFAULT_MATCHES = 5;
const MAX_MATCHES = 8;

const wordsOf = ({ text }: { text: string }): string[] =>
  [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 2),
    ),
  ].map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));

/**
 * Searches the catalog by the words of a tool's name (heavy) and description (light), best first.
 * A tool whose whole name is the query wins, and a shorter name wins a tie, so "delete account"
 * finds `delete_account` before `delete_account_group`.
 */
function score({ queryWords, name, description }: { queryWords: string[]; name: string; description: string }): number {
  const nameWords = wordsOf({ text: name });
  const descriptionWords = new Set(wordsOf({ text: description }));

  let total = 0;
  let inName = 0;
  for (const word of queryWords) {
    if (nameWords.includes(word)) {
      total += 3;
      inName++;
    } else if (nameWords.some((nameWord) => nameWord.startsWith(word) || word.startsWith(nameWord))) {
      total += 2;
    } else if (descriptionWords.has(word)) {
      total += 1;
    }
  }

  if (total > 0 && inName === queryWords.length) total += 5;
  if (queryWords.join('_') === nameWords.join('_')) total += 10;
  return total;
}

const render = ({ entries }: { entries: ToolCatalogEntry[] }) =>
  JSON.stringify({
    matches: entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      kind: entry.access,
      inputSchema: getModelSchema({ entry }),
    })),
  });

export function createFindCapabilitiesTool({ ctx }: { ctx: ChatToolContext }) {
  return defineNativeTool({
    name: 'find_capabilities',
    description:
      'Search the tools not offered by default (settings, loans, investments, imports, ...) by what you want to do. Returns names, descriptions and input schemas, and makes the matches callable from your next step.',
    shape: {
      query: z.string().trim().min(1).max(200).describe('What you want to do, in a few words, e.g. "delete account"'),
      limit: z.number().int().min(1).max(MAX_MATCHES).optional().describe('How many tools to return (default 5)'),
    },
    run: async ({ args }) => {
      const queryWords = wordsOf({ text: args.query });

      const ranked = ctx.catalog
        .filter((entry) => !(entry.name in CHAT_EXCLUDED_TOOLS))
        .map((entry) => ({
          entry,
          score: score({ queryWords, name: entry.name, description: entry.description }),
        }))
        .filter(({ score: value }) => value > 0)
        .toSorted((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length)
        .slice(0, args.limit ?? DEFAULT_MATCHES)
        .map(({ entry }) => entry);

      // The schemas are the answer, so a result over the cap loses whole tools rather than a cut JSON.
      let matches = ranked;
      while (matches.length > 1 && render({ entries: matches }).length > CHAT_READ_RESULT_MAX_CHARS) {
        matches = matches.slice(0, -1);
      }

      for (const entry of matches) ctx.state.discovered.add(entry.name);
      return toolSuccess({ text: render({ entries: matches }) });
    },
  });
}
