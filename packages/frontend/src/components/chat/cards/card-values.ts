import type { ChatCardField, ChatEntityKind, ChatProposalCard } from '@bt/shared/types';

/** How the server writes a reference to a card in the same message that has not been applied yet. */
const PROPOSAL_REF_PREFIX = '$proposal:';

const SUMMARY_MAX_CHARS = 120;

const isRefString = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(PROPOSAL_REF_PREFIX);

export const isProposalRef = ({ value }: { value: unknown }): boolean => isRefString(value);

/** The id of the card a `$proposal:` ref points to, or `null` when the value is not a ref. */
export const proposalRefId = ({ value }: { value: unknown }): string | null =>
  isRefString(value) ? value.slice(PROPOSAL_REF_PREFIX.length) : null;

/** The entity a field names, from its editor or its display; `null` for a field that names none. */
export const fieldEntityKind = ({ field }: { field: ChatCardField }): ChatEntityKind | null =>
  field.editable?.entity ?? field.display?.entity?.kind ?? null;

/** The arguments the card holds, rebuilt from its fields. */
export const cardArgsOf = ({ card }: { card: ChatProposalCard }): Record<string, unknown> =>
  Object.fromEntries(card.fields.map((field) => [field.path, field.value]));

/** The complete argument set with one argument replaced: what an edit sends. */
export const replaceArg = ({
  card,
  path,
  value,
}: {
  card: ChatProposalCard;
  path: string;
  value: unknown;
}): Record<string, unknown> => ({ ...cardArgsOf({ card }), [path]: value });

const sameValue = ({ a, b }: { a: unknown; b: unknown }) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The argument set an edit sends and the paths that differ from the card. The server replaces the
 * whole set, so every other argument travels unchanged; a key that is not a field of the card is ignored.
 */
export const buildEditedArgs = ({
  card,
  draft,
}: {
  card: ChatProposalCard;
  draft: Record<string, unknown>;
}): { args: Record<string, unknown>; changed: string[] } => {
  const current = cardArgsOf({ card });
  const args: Record<string, unknown> = { ...current };
  const changed: string[] = [];

  for (const [path, value] of Object.entries(draft)) {
    if (!(path in current)) continue;
    args[path] = value;
    if (!sameValue({ a: current[path], b: value })) changed.push(path);
  }

  return { args, changed };
};

const stringValue = ({ card, path }: { card: ChatProposalCard; path: string }): string | null => {
  const value = card.fields.find((field) => field.path === path)?.value;
  return typeof value === 'string' && !isProposalRef({ value }) ? value : null;
};

/** The argument that holds the currency an amount argument is written in, when it is not the account's. */
const CURRENCY_FIELD_OF: Readonly<Record<string, string>> = { originalAmount: 'originalCurrencyCode' };

/** The account argument whose currency an amount argument is written in. */
const ACCOUNT_FIELD_OF: Readonly<Record<string, string>> = { destinationAmount: 'destinationAccountId' };

/**
 * The currency an amount on a card is written in. The card does not carry it, so it comes from the
 * card's own arguments: a currency argument, then the account the amount belongs to, then the base currency.
 */
export const moneyCurrencyOf = ({
  card,
  path,
  accountCurrency,
  baseCurrencyCode,
}: {
  card: ChatProposalCard;
  path: string;
  accountCurrency: (params: { id: string }) => string | null;
  baseCurrencyCode: string | null;
}): string | null => {
  const named = stringValue({ card, path: CURRENCY_FIELD_OF[path] ?? 'currencyCode' });
  if (named) return named;

  const accountId = stringValue({ card, path: ACCOUNT_FIELD_OF[path] ?? 'accountId' });
  return (accountId ? accountCurrency({ id: accountId }) : null) ?? baseCurrencyCode;
};

/** A value as short text: scalars as they are, lists joined, structures as compact JSON cut to a line. */
export const summarizeValue = ({ value }: { value: unknown }): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
    return value.map(String).join(', ');
  }

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}…` : text;
};
