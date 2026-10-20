import type { ChatEntityKind, ChatFieldDisplay, ChatFieldEditable } from '@bt/shared/types';

import type { JsonSchema } from '../toolkit/types';

/** Money arguments: shown as an amount and edited as one. A currency code argument is a picker, not money. */
const MONEY_FIELD = /(amount|balance|creditlimit)$/i;

const isRefAlternative = ({ node }: { node: JsonSchema }) =>
  node.type === 'string' && typeof node.pattern === 'string' && node.pattern.includes('$proposal');

/** Looks through nullability and the ref-tolerant uuid pair; a real union stays a union. */
function simplify({ node }: { node: unknown }): JsonSchema {
  if (node === null || typeof node !== 'object') return {};

  const { anyOf, ...rest } = node as JsonSchema;
  if (!Array.isArray(anyOf)) return node as JsonSchema;

  const alternatives = (anyOf as JsonSchema[]).filter((alternative) => alternative.type !== 'null');
  if (alternatives.length === 1) return { ...rest, ...alternatives[0] };

  const uuid = alternatives.find((alternative) => alternative.format === 'uuid');
  if (uuid && alternatives.some((alternative) => isRefAlternative({ node: alternative }))) return { ...rest, ...uuid };

  return node as JsonSchema;
}

/** A date or a UTC date and time written as ISO text, in an argument whose schema says only "string". */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isIdLike = ({ node }: { node: JsonSchema }) =>
  node.type === 'string' || (node.type === 'array' && simplify({ node: node.items }).type === 'string');

/** How a card shows one argument, from its schema and the entity the policy maps it to. */
export function describeField({
  key,
  value,
  node,
  entityKind,
}: {
  key: string;
  value: unknown;
  node: unknown;
  entityKind: ChatEntityKind | undefined;
}): { display?: ChatFieldDisplay; editable: ChatFieldEditable | null } {
  const schema = simplify({ node });
  const isNumber = schema.type === 'number' || schema.type === 'integer';

  if (entityKind && isIdLike({ node: schema })) {
    return { display: { kind: 'entity' }, editable: { type: 'entity', entity: entityKind } };
  }
  if (isNumber && MONEY_FIELD.test(key)) return { display: { kind: 'money' }, editable: { type: 'money' } };

  // A subscription's matching rules are a list of small objects; the card reads them as sentences.
  if (key === 'matchingRules') return { display: { kind: 'matchingRules' }, editable: null };

  // A list of presets (reminder offsets) reads as its options, one name each.
  if (schema.type === 'array' && Array.isArray(simplify({ node: schema.items }).enum)) {
    return { display: { kind: 'enum' }, editable: null };
  }

  if (Array.isArray(schema.enum)) {
    return { display: { kind: 'enum' }, editable: { type: 'enum', options: schema.enum.map(String) } };
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'date-time') return { display: { kind: 'datetime' }, editable: { type: 'datetime' } };
      if (schema.format === 'date') return { display: { kind: 'date' }, editable: { type: 'date' } };
      if (typeof value === 'string' && ISO_DATE_TIME.test(value))
        return { display: { kind: 'datetime' }, editable: { type: 'datetime' } };
      if (typeof value === 'string' && ISO_DATE.test(value))
        return { display: { kind: 'date' }, editable: { type: 'date' } };
      return { display: { kind: 'text' }, editable: schema.format === 'uuid' ? null : { type: 'text' } };
    case 'number':
    case 'integer':
      return { display: { kind: 'text' }, editable: { type: 'number' } };
    case 'boolean':
      return { display: { kind: 'boolean' }, editable: { type: 'boolean' } };
    default:
      return { display: typeof value === 'object' ? undefined : { kind: 'text' }, editable: null };
  }
}
