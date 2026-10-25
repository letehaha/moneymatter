import type { JSONSchema7, JSONSchema7Definition } from '@ai-sdk/provider';

type SchemaMap = Record<string, JSONSchema7Definition>;

function mapDefinition({
  definition,
  visit,
}: {
  definition: JSONSchema7Definition;
  visit: (node: JSONSchema7) => JSONSchema7;
}): JSONSchema7Definition {
  if (typeof definition === 'boolean') return definition;

  return mapSchema({ schema: definition, visit });
}

function mapSchemaMap({ map, visit }: { map: SchemaMap; visit: (node: JSONSchema7) => JSONSchema7 }): SchemaMap {
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, mapDefinition({ definition: value, visit })]),
  );
}

/**
 * Applies `visit` to a schema and every sub-schema, children first. Only schema positions are
 * visited, so a property that happens to be called `format` is left alone.
 */
function mapSchema({ schema, visit }: { schema: JSONSchema7; visit: (node: JSONSchema7) => JSONSchema7 }): JSONSchema7 {
  const next: JSONSchema7 = { ...schema };

  if (schema.properties) next.properties = mapSchemaMap({ map: schema.properties, visit });
  if (schema.patternProperties) next.patternProperties = mapSchemaMap({ map: schema.patternProperties, visit });
  if (schema.definitions) next.definitions = mapSchemaMap({ map: schema.definitions, visit });

  const $defs = (schema as { $defs?: SchemaMap }).$defs;

  if ($defs) (next as { $defs?: SchemaMap }).$defs = mapSchemaMap({ map: $defs, visit });

  if (schema.items) {
    next.items = Array.isArray(schema.items)
      ? schema.items.map((item) => mapDefinition({ definition: item, visit }))
      : mapDefinition({ definition: schema.items, visit });
  }

  for (const key of ['additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else'] as const) {
    const value = schema[key];

    if (value !== undefined) next[key] = mapDefinition({ definition: value, visit });
  }

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const value = schema[key];

    if (value) next[key] = value.map((entry) => mapDefinition({ definition: entry, visit }));
  }

  return visit(next);
}

/** The AI SDK still validates the answer against the Zod schema, so the CLI only needs the structure. */
export function stripSchemaFormats({ schema }: { schema: JSONSchema7 }): JSONSchema7 {
  return mapSchema({
    schema,
    visit: (node) => {
      const { format: _format, ...rest } = node;

      return rest;
    },
  });
}

/** Codex's `--output-schema` follows OpenAI structured outputs, which refuse objects that allow extra keys. */
export function closeObjectSchemas({ schema }: { schema: JSONSchema7 }): JSONSchema7 {
  return mapSchema({
    schema,
    visit: (node) => {
      const isObject = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));

      return isObject || node.properties ? { ...node, additionalProperties: false } : node;
    },
  });
}
