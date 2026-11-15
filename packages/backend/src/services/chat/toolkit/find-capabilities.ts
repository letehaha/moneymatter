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

/**
 * Words people use for a change that its tool's name and description do not hold ("log a coffee" for
 * `create_transaction`). The common write tools are found by search and not offered on every step, so
 * a request in everyday words has to reach them; a hint weighs more than a description word.
 */
const SEARCH_HINTS: Readonly<Record<string, string>> = {
  create_transaction: 'log add record new expense income spent spend paid pay bought purchase payment coffee receipt',
  update_transaction:
    'edit fix change correct modify rename recategorize categorize category move date amount note this one',
  delete_transaction: 'remove delete erase duplicate wrong entry this one',
  bulk_update_transactions: 'recategorize categorize move retag many all several rename change fix',
  bulk_delete_transactions: 'remove delete erase duplicates duplicate many all several filter',
  assign_tags_to_transaction: 'tag tags label retag',
  create_category: 'add new make category',
  create_tag: 'add new make tag label',
  create_payee: 'add new make merchant payee',
  create_account: 'add new make open account wallet card',
};

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
 * Searches the catalog by the words of a tool's name (heavy), its search hints and its description
 * (light), best first.
 * A tool whose whole name is the query wins, and a shorter name wins a tie, so "delete transaction"
 * finds `delete_transaction` before `delete_transaction_group`.
 */
function score({
  queryWords,
  name,
  description,
  hints = '',
}: {
  queryWords: string[];
  name: string;
  description: string;
  hints?: string;
}): number {
  const nameWords = wordsOf({ text: name });
  const hintWords = new Set(wordsOf({ text: hints }));
  const descriptionWords = new Set(wordsOf({ text: description }));

  let total = 0;
  let inName = 0;
  for (const word of queryWords) {
    if (nameWords.includes(word)) {
      total += 3;
      inName++;
    } else if (nameWords.some((nameWord) => nameWord.startsWith(word) || word.startsWith(nameWord))) {
      total += 2;
    } else if (hintWords.has(word)) {
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
      'Search the tools not offered by default (changes to transactions, categories, tags, payees and accounts; settings, loans, investments, imports, ...) by what you want to do. Returns names, descriptions, kinds and input schemas, and makes the matches callable from your next step. The kind is read (answers at once), write or delete (each call proposes a card for the user to approve).',
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
          score: score({
            queryWords,
            name: entry.name,
            description: entry.description,
            hints: SEARCH_HINTS[entry.name],
          }),
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
