import {
  CHAT_ENTITY_KINDS,
  type ChatCardDanger,
  type ChatCardKind,
  type ChatConfirmationMode,
  type ChatEntityKind,
} from '@bt/shared/types';

/**
 * Names of the preview resolvers a policy can declare. The resolver registry
 * (`proposals/previews`) is typed as a record over this list, so a name added here without a
 * resolver, or a resolver without a name, does not compile. `entity` is the generic loader: the
 * row a policy's `targetFields` name, with its related counts.
 */
export const PREVIEW_RESOLVER_NAMES = [
  'entity',
  'bulkUpdateTransactions',
  'bulkDeleteTransactions',
  'bulkDeletePayees',
  'mergePayees',
  'removeDuplicateTransactions',
  'mergeDuplicateTransactions',
  'deleteImportBatch',
  'changeBaseCurrency',
  'deleteExchangeRates',
  'applyTransactionAutomation',
  'applyPayeeTags',
  'ignorePayeeName',
  'revertSubscriptionPeriod',
  'linkTransactionsToSubscription',
  'unlinkTransactionsFromSubscription',
  'budgetPlanAssignment',
] as const;

export type PreviewResolverName = (typeof PREVIEW_RESOLVER_NAMES)[number];

/**
 * Tools whose effect is wide or hard to take back even though their name does not say so. Kept by
 * hand: a new tool of this weight is only treated as one once it is listed here.
 */
export const HIGH_IMPACT_TOOLS: readonly string[] = [
  'change_base_currency',
  'delete_import_batch',
  'unlink_account_from_bank_connection',
  'remove_duplicate_transactions',
  'merge_duplicate_transactions',
];

/** A host the server will contact because the arguments name it. */
export interface ChatEgress {
  url: string;
  host: string;
}

export interface ToolPolicy {
  name: string;
  kind: ChatCardKind;
  entity: ChatEntityKind;
  /** The level on every path; `resolveToolPolicy` raises it for a path the arguments pick. */
  danger: ChatCardDanger;
  /** `null` is an args-only card, which the tool must be listed for in `CHAT_ARGS_ONLY_TOOLS`. */
  previewResolver: PreviewResolverName | null;
  /** The arguments that name the target row, for the `entity` loader; empty for every other resolver. */
  targetFields: string[];
  /** Dot path in the handler's parsed JSON output to the id of the entity a create call made. */
  resultIdPath: string;
  /** Queues work or commits on its own, so it cannot join an approval chain. */
  standalone: boolean;
  /** Argument name to the entity its value names, for the card's entity labels and pickers. */
  entityFields: Readonly<Record<string, ChatEntityKind>>;
}

export interface ResolvedToolPolicy extends ToolPolicy {
  egress: ChatEgress | null;
}

interface VerbRule {
  pattern: RegExp;
  kind: ChatCardKind;
  danger: ChatCardDanger;
}

/** First match wins; a name that matches none is an `action`. */
const VERB_RULES: readonly VerbRule[] = [
  { pattern: /^create_(.+)$/, kind: 'create', danger: 'none' },
  { pattern: /^(?:update|set)_(.+)$/, kind: 'update', danger: 'none' },
  { pattern: /^delete_(.+)$/, kind: 'delete', danger: 'destructive' },
  { pattern: /^bulk_(?:update_|delete_)?(.+)$/, kind: 'bulk', danger: 'destructive' },
  { pattern: /^merge_(.+)$/, kind: 'merge', danger: 'destructive' },
  { pattern: /^(?:link|unlink|assign|remove)_(.+)$/, kind: 'link', danger: 'none' },
];

const toCamelCase = ({ value }: { value: string }) =>
  value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

const singularOf = ({ word }: { word: string }) => {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
};

const isEntityKind = ({ value }: { value: string }) => (CHAT_ENTITY_KINDS as readonly string[]).includes(value);

/** What the verb of a tool name says: its card kind, its red level and the entity the rest of the name spells. */
export function deriveFromName({ name }: { name: string }): {
  kind: ChatCardKind;
  danger: ChatCardDanger;
  entity: ChatEntityKind | null;
} {
  for (const rule of VERB_RULES) {
    const rest = rule.pattern.exec(name)?.[1];
    if (rest === undefined) continue;

    const camel = toCamelCase({ value: rest });
    const entity = [camel, singularOf({ word: camel })].find((candidate) => isEntityKind({ value: candidate })) ?? null;
    return { kind: rule.kind, danger: rule.danger, entity: entity as ChatEntityKind | null };
  }

  return { kind: 'action', danger: 'none', entity: null };
}

const DANGER_RANK: Record<ChatCardDanger, number> = { none: 0, destructive: 1, highImpact: 2 };

export const strictestDanger = ({ levels }: { levels: ChatCardDanger[] }): ChatCardDanger =>
  levels.reduce<ChatCardDanger>((top, level) => (DANGER_RANK[level] > DANGER_RANK[top] ? level : top), 'none');

/**
 * The confirmation a card asks for, the strictest of its danger and its egress. A red card that
 * affects one record needs a second confirmation. A red card that affects more than one record,
 * and every high-impact card, needs the affected count typed (a number reads the same in every
 * locale). An egress card needs a confirmation that repeats the host.
 */
export function confirmationFor({
  danger,
  egress,
  affectedCount,
}: {
  danger: ChatCardDanger;
  egress: ChatEgress | null;
  affectedCount?: number;
}): { mode: ChatConfirmationMode; phrase?: string } {
  const typed =
    affectedCount !== undefined && (danger === 'highImpact' || (danger === 'destructive' && affectedCount > 1));
  if (typed) return { mode: 'typed', phrase: String(affectedCount) };

  if (danger !== 'none' || egress !== null) return { mode: 'confirm' };

  return { mode: 'none' };
}
