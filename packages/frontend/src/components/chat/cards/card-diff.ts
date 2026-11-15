import type { ChatCardField, ChatProposalCard } from '@bt/shared/types';

import { keptCurrencyOf } from './card-values';

/**
 * How a row of the card reads: an `added` field fills in something that was empty, a `changed` one replaces a real
 * value (and carries it); the rest are shown as they are.
 */
export type CardRowTone = 'normal' | 'changed' | 'added';

/** Whether the field replaces a real value; an old value that was empty (or a null that means nothing) does not. */
export const hasOldValue = ({ field }: { field: ChatCardField }): boolean => {
  const { before } = field;
  if (before === undefined) return false;
  return !isBlank({ value: before });
};

const isBlank = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** Whether the card leaves the field as it was: the same value, or blank before and after (an empty note stays empty). */
const isUnchanged = ({ field }: { field: ChatCardField }): boolean => {
  if (isBlank({ value: field.value }) && isBlank({ value: field.before })) return true;
  return JSON.stringify(field.value) === JSON.stringify(field.before);
};

interface CardRow {
  field: ChatCardField;
  tone: CardRowTone;
  /** Where the field came from: the card's own arguments, or the record the card targets. */
  source: 'card' | 'target';
  /** The currency the record stores an amount in: the value it replaces is in that one, wherever the card moves it. */
  beforeCurrencyCode?: string;
}

/** The last segment of a field path: a nested argument is named like a top-level one. */
const keyOf = ({ field }: { field: ChatCardField }) => field.path.split('.').at(-1) ?? field.path;

/**
 * The one list an update card shows. The record the card targets (read from the stored row) and the card's own
 * fields describe the same record, so each field appears once: a changed one highlighted with the value it
 * replaces, an identifying one the card leaves alone as it is, so the record is still recognisable. The argument the policy
 * marks as only naming the record is left out; the identifying fields say it better, and every other argument,
 * even one of the same kind (a new parent, a category to move to), stays. A card with nothing changed (a delete) shows
 * its record plainly, and a card without a target (a create) shows its fields.
 */
export const buildCardRows = ({ card }: { card: ChatProposalCard }): CardRow[] => {
  const toneOf = ({ field }: { field: ChatCardField }): CardRowTone => {
    if (field.before === undefined || isUnchanged({ field })) return 'normal';
    return hasOldValue({ field }) ? 'changed' : 'added';
  };
  const target = card.target ?? [];

  if (target.length === 0) {
    return card.fields.map((field) => ({ field, tone: toneOf({ field }), source: 'card' }));
  }

  const fields = card.fields.filter((field) => field.namesRecord !== true);
  const used = new Set<ChatCardField>();
  const identifying = target.map((identified): CardRow => {
    const own = fields.find((field) => keyOf({ field }) === keyOf({ field: identified }));
    if (!own) return { field: identified, tone: 'normal', source: 'target' };

    used.add(own);
    if (own.display?.kind !== 'money') return { field: own, tone: toneOf({ field: own }), source: 'card' };

    // The card's amount argument carries no currency; the record's own is what it is in, unless the card replaces it.
    const kept = keptCurrencyOf({ card, path: identified.path });
    const field = kept && !own.display.currencyCode ? { ...own, display: { ...own.display, currencyCode: kept } } : own;
    const beforeCurrencyCode = identified.display?.currencyCode;

    return { field, tone: toneOf({ field }), source: 'card', ...(beforeCurrencyCode ? { beforeCurrencyCode } : {}) };
  });

  const rest = fields
    .filter((field) => !used.has(field))
    .map((field): CardRow => ({ field, tone: toneOf({ field }), source: 'card' }));

  return [...identifying, ...rest];
};
