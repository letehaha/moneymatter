import { READ_TOOL_NAME, DESTRUCTIVE_TOOLS } from '../../mcp/tool-classification';
import { buildEntityFields } from './entity-fields';
import { CHAT_EXCLUDED_TOOLS } from './excluded';
import { CONDITIONAL_DANGER, EGRESS_TOOLS, ENTITY_LOADER_KINDS, EXPLICIT_POLICIES, STANDALONE_TOOLS } from './explicit';
import {
  deriveFromName,
  HIGH_IMPACT_TOOLS,
  strictestDanger,
  type PreviewResolverName,
  type ResolvedToolPolicy,
  type ToolPolicy,
} from './rules';

const policies = new Map<string, ToolPolicy | null>();

function buildPolicy({ name }: { name: string }): ToolPolicy | null {
  if (READ_TOOL_NAME.test(name) || name in CHAT_EXCLUDED_TOOLS) return null;

  const derived = deriveFromName({ name });
  const explicit = EXPLICIT_POLICIES[name] ?? {};
  const entity = explicit.entity ?? derived.entity;
  if (entity === null) return null;

  const kind = explicit.kind ?? derived.kind;
  const danger = strictestDanger({
    levels: [
      explicit.danger ?? derived.danger,
      DESTRUCTIVE_TOOLS.includes(name) ? 'destructive' : 'none',
      HIGH_IMPACT_TOOLS.includes(name) ? 'highImpact' : 'none',
    ],
  });

  const loadsEntity = (kind === 'update' || kind === 'delete') && ENTITY_LOADER_KINDS.includes(entity);
  const previewResolver: PreviewResolverName | null =
    explicit.previewResolver !== undefined ? explicit.previewResolver : loadsEntity ? 'entity' : null;

  return {
    name,
    kind,
    entity,
    danger,
    previewResolver,
    targetFields: previewResolver === 'entity' ? (explicit.targetFields ?? [`${entity}Id`]) : [],
    resultIdPath: explicit.resultIdPath ?? 'id',
    standalone: STANDALONE_TOOLS.includes(name),
    entityFields: buildEntityFields({ entity, overrides: explicit.entityFields }),
  };
}

/**
 * The policy of a write capability: what card its proposals become and how that card is previewed.
 * `null` for a read tool, an excluded tool, and a write tool whose name the rules cannot place in an
 * entity and that has no explicit entry (the drift suite fails until it has one).
 */
export function getToolPolicy({ name }: { name: string }): ToolPolicy | null {
  if (!policies.has(name)) policies.set(name, buildPolicy({ name }));
  return policies.get(name) ?? null;
}

/**
 * The policy for one call: the static policy with the danger level and the egress target the
 * arguments pick (`ignore_payee_name` with `force` deletes; an HTTP rate source contacts a host).
 */
export function resolveToolPolicy({ name, args }: { name: string; args: unknown }): ResolvedToolPolicy | null {
  const policy = getToolPolicy({ name });
  if (!policy) return null;

  return {
    ...policy,
    danger: strictestDanger({ levels: [policy.danger, CONDITIONAL_DANGER[name]?.({ args }) ?? 'none'] }),
    egress: EGRESS_TOOLS[name]?.({ args }) ?? null,
  };
}
