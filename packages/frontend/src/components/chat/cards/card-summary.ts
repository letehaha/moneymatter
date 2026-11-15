import type { ChatCardField, ChatProposalCard } from '@bt/shared/types';

/**
 * What a folded card names, in order: when, how much, who or what, and from which account. Each group
 * gives its first field the card has, so a transaction reads "date · amount · payee · account".
 */
const SUMMARY_GROUPS: ReadonlyArray<readonly string[]> = [
  ['time', 'date', 'eventDate', 'startDate'],
  ['amount', 'expectedAmount', 'grossAmount'],
  ['payeeId', 'name', 'rawName', 'lenderName', 'filename', 'description', 'note'],
  ['accountId'],
];

/** A card none of whose fields falls in a group names its first ones instead. */
const FALLBACK_FIELD_COUNT = 2;

const isPresent = ({ field }: { field: ChatCardField }) =>
  field.value !== null && field.value !== undefined && field.value !== '';

/** The last segment of a field path: a nested argument is named like a top-level one. */
const keyOf = ({ field }: { field: ChatCardField }) => field.path.split('.').at(-1) ?? field.path;

/**
 * The fields the one-line summary of a folded card shows. An update or delete card is about the record
 * it targets, so its identifying fields come first; any other card is about its own fields.
 */
export const summaryFields = ({ card }: { card: ChatProposalCard }): ChatCardField[] => {
  const source = (card.target && card.target.length > 0 ? card.target : card.fields).filter((field) =>
    isPresent({ field }),
  );

  const picked = SUMMARY_GROUPS.flatMap((group) => {
    const field = group
      .map((key) => source.find((candidate) => keyOf({ field: candidate }) === key))
      .find((candidate) => candidate !== undefined);
    return field ? [field] : [];
  });

  return picked.length > 0 ? picked : source.slice(0, FALLBACK_FIELD_COUNT);
};
