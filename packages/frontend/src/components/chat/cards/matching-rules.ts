import type { ChatEntityKind } from '@bt/shared/types';

type Translate = (key: string, params?: Record<string, unknown>) => string;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The bound of an amount rule as written (`9.5`, not `9.50`), or `?` for one that is not a number. */
const bound = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : '?');

/** One rule as a sentence; a rule the card does not know is shown as its fields. */
const describeRule = ({
  rule,
  t,
  entityName,
  enumValue,
}: {
  rule: unknown;
  t: Translate;
  entityName: (params: { kind: ChatEntityKind; id: string }) => string | null;
  enumValue: (params: { path: string; value: string }) => string;
}): string => {
  if (!isRecord(rule)) return String(rule);

  const { field, value } = rule;
  if (field === 'note' && Array.isArray(value)) {
    return t('chat.cards.matchingRules.note', { values: value.map((item) => `“${String(item)}”`).join(', ') });
  }
  if (field === 'amount' && isRecord(value)) {
    const params = { min: bound({ value: value.min }), max: bound({ value: value.max }) };
    return typeof rule.currencyCode === 'string'
      ? t('chat.cards.matchingRules.amountCurrency', { ...params, currency: rule.currencyCode })
      : t('chat.cards.matchingRules.amount', params);
  }
  if (field === 'transactionType' && typeof value === 'string') {
    return t('chat.cards.matchingRules.transactionType', { value: enumValue({ path: 'transactionType', value }) });
  }
  if (field === 'accountId' && typeof value === 'string') {
    return t('chat.cards.matchingRules.account', { name: entityName({ kind: 'account', id: value }) ?? value });
  }

  return JSON.stringify(rule);
};

/**
 * A subscription's matching rules as one line: every rule must pass, so the sentences are joined as a
 * list. `null` and an empty list read as no rules; a value that is not the rules shape is shown as is.
 */
export const describeMatchingRules = ({
  value,
  t,
  entityName,
  enumValue,
}: {
  value: unknown;
  t: Translate;
  entityName: (params: { kind: ChatEntityKind; id: string }) => string | null;
  enumValue: (params: { path: string; value: string }) => string;
}): string => {
  if (value === null || value === undefined) return t('chat.cards.matchingRules.none');
  if (!isRecord(value) || !Array.isArray(value.rules)) return JSON.stringify(value);
  if (value.rules.length === 0) return t('chat.cards.matchingRules.none');

  return value.rules.map((rule) => describeRule({ rule, t, entityName, enumValue })).join('; ');
};
