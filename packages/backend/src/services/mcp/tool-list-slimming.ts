import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Formats a client already understands by name. The generated JSON Schema also spells each one
 * out as a regular expression (about 150 bytes per UUID, 400 per date), repeated on every id
 * and date field of every tool. The server still validates with the full schema when a tool is
 * called; only the advertised copy drops the expression.
 *
 * `date-time` is not in the set: zod accepts only a UTC time (ending in Z) there, which is
 * stricter than the format's name says, and its pattern is the one place a client can read
 * that rule.
 */
const SELF_DESCRIBING_FORMATS = new Set(['uuid', 'date']);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Returns a copy of `schema` without the `pattern` that sits next to a uuid or date `format`. */
export function slimToolListSchema<T>({ schema }: { schema: T }): T {
  return slimValue({ value: schema as JsonValue }) as T;
}

function slimValue({ value }: { value: JsonValue }): JsonValue {
  if (Array.isArray(value)) return value.map((item) => slimValue({ value: item }));
  if (value === null || typeof value !== 'object') return value;

  const dropPattern = typeof value.format === 'string' && SELF_DESCRIBING_FORMATS.has(value.format);
  const slimmed: { [key: string]: JsonValue } = {};
  for (const [key, child] of Object.entries(value)) {
    // `pattern` is a keyword only when its value is a string; a property can be named `pattern`.
    if (dropPattern && key === 'pattern' && typeof child === 'string') continue;
    slimmed[key] = slimValue({ value: child });
  }
  return slimmed;
}

type RequestHandler = (...params: unknown[]) => unknown;

/**
 * Makes `tools/list` answer with slimmed input schemas. Wraps the handler the SDK registers when
 * the first tool is added, so call it before any `registerTool`.
 */
export function slimToolListing({ server }: { server: McpServer }): void {
  const protocol = server.server;
  const setRequestHandler = protocol.setRequestHandler.bind(protocol) as (
    schema: unknown,
    handler: RequestHandler,
  ) => void;

  (protocol as unknown as { setRequestHandler: typeof setRequestHandler }).setRequestHandler = (schema, handler) => {
    const method = (schema as { shape?: { method?: { value?: unknown } } }).shape?.method?.value;
    if (method !== 'tools/list') return setRequestHandler(schema, handler);

    return setRequestHandler(schema, async (...params) => {
      const result = (await handler(...params)) as { tools: Array<{ inputSchema: unknown }> };
      return {
        ...result,
        tools: result.tools.map((tool) => ({ ...tool, inputSchema: slimToolListSchema({ schema: tool.inputSchema }) })),
      };
    });
  };
}
