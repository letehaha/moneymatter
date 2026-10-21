import {
  CHAT_FIELD_LABEL_KEYS,
  type ChatCardField,
  type ChatEntityKind,
  type ChatFieldDisplay,
} from '@bt/shared/types';

/**
 * The fields that tell one record from another, in the order a card lists them. A key a record does not
 * have is skipped, so one list serves every entity; `onlyAlone` keys are shown only when nothing else
 * identifies the record.
 */
export const IDENTIFYING_FIELDS: ReadonlyArray<{
  key: string;
  kind: ChatFieldDisplay['kind'];
  entity?: ChatEntityKind;
  onlyAlone?: boolean;
}> = [
  { key: 'name', kind: 'text' },
  { key: 'filename', kind: 'text' },
  { key: 'rawName', kind: 'text' },
  { key: 'lenderName', kind: 'text' },
  { key: 'make', kind: 'text' },
  { key: 'model', kind: 'text' },
  { key: 'amount', kind: 'money' },
  { key: 'expectedAmount', kind: 'money' },
  { key: 'grossAmount', kind: 'money' },
  { key: 'quantity', kind: 'text' },
  { key: 'time', kind: 'datetime' },
  { key: 'date', kind: 'date' },
  { key: 'eventDate', kind: 'date' },
  { key: 'startDate', kind: 'date' },
  { key: 'description', kind: 'text' },
  { key: 'note', kind: 'text' },
  { key: 'payeeId', kind: 'entity', entity: 'payee' },
  { key: 'accountId', kind: 'entity', entity: 'account' },
  { key: 'categoryId', kind: 'entity', entity: 'category' },
  { key: 'transactionType', kind: 'enum' },
  { key: 'type', kind: 'text', onlyAlone: true },
  { key: 'currencyCode', kind: 'text' },
];

const isPresent = ({ value }: { value: unknown }) => value !== null && value !== undefined && value !== '';

/** A money value of a stored row is a decimal, as a number or as text. */
const toNumber = ({ value }: { value: unknown }): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * The record an update or delete card targets, by the fields that identify it. Built from the row the
 * preview read, never from the model's arguments, so the card shows what will change whatever the model
 * said. The currency code is shown with the amount, and on its own only for a record that has no amount.
 */
export function buildCardTarget({ before }: { before: Record<string, unknown> | null | undefined }): ChatCardField[] {
  if (!before) return [];

  const currencyCode = [before.currencyCode, before.expectedCurrencyCode].find(
    (code): code is string => typeof code === 'string' && code !== '',
  );

  const found = IDENTIFYING_FIELDS.flatMap((definition) => {
    const { key, kind, entity } = definition;
    const raw = before[key];
    if (!isPresent({ value: raw })) return [];

    const value = kind === 'money' ? toNumber({ value: raw }) : raw;
    if (value === null) return [];

    const field: ChatCardField = {
      path: key,
      labelKey: CHAT_FIELD_LABEL_KEYS[key] ?? `chat.fields.${key}`,
      value,
      display: {
        kind,
        ...(kind === 'money' && currencyCode ? { currencyCode } : {}),
        // The card names the record from the app's own lists; the label is only a placeholder.
        ...(entity ? { entity: { kind: entity, id: String(value), label: '' } } : {}),
      },
      editable: null,
    };
    return [{ field, onlyAlone: definition.onlyAlone === true }];
  });

  // `type` and the currency say little by themselves: they stand in only for a record with nothing better.
  const better = found.filter((item) => !item.onlyAlone);
  const shown = better.length > 0 ? better : found;
  // An amount carries its currency, so the code is a field of its own only for a record without one.
  const hasMoney = shown.some((item) => item.field.display?.kind === 'money');
  return shown.filter((item) => !(hasMoney && item.field.path === 'currencyCode')).map((item) => item.field);
}
