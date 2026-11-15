import { z } from 'zod';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';

/** A tool input the model can fix: the message goes back to it as a tool error. */
export class ToolInputError extends Error {}

const PROPOSAL_REF_PREFIX = '$proposal:';
const PROPOSAL_REF_PATTERN = /^\$proposal:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** A valid uuid for each ref, distinct per ref, so `recordId()` accepts it and a uniqueness rule still sees two ids. */
const placeholderFor = ({ index }: { index: number }) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

export const proposalRef = ({ id }: { id: string }) => `${PROPOSAL_REF_PREFIX}${id}`;

export const isProposalRef = ({ value }: { value: unknown }): boolean =>
  typeof value === 'string' && PROPOSAL_REF_PATTERN.test(value);

/** The ids of the proposals a value refers to at any depth, once each, in order of appearance. */
export function findProposalRefs({ value }: { value: unknown }): string[] {
  const found = new Set<string>();

  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      const id = PROPOSAL_REF_PATTERN.exec(node)?.[1];
      if (id) found.add(id);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);

  return [...found];
}

const replaceRefs = ({ value, placeholders }: { value: unknown; placeholders: Map<string, string> }): unknown => {
  if (typeof value === 'string') {
    const id = PROPOSAL_REF_PATTERN.exec(value)?.[1];
    return id ? placeholders.get(id) : value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceRefs({ value: item, placeholders }));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceRefs({ value: item, placeholders })]),
    );
  }
  return value;
};

/** `path: message` for each issue of a zod error, which is what the model needs to repair its call. */
export function describeInputError({ error }: { error: unknown }): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates a tool's arguments where some ids may not exist yet. Every `$proposal:<id>` is replaced
 * by a placeholder uuid on a copy, and the tool's real schema and `validateArgs` run on that copy,
 * so an id field inside a shared body schema accepts it too. The arguments given are left as they
 * are: the stored arguments keep their refs. Throws `ToolInputError` with the reason.
 */
export function validateWithRefs({ entry, args }: { entry: ToolCatalogEntry; args: unknown }): {
  refs: string[];
  parsedArgs: unknown;
} {
  const refs = findProposalRefs({ value: args });
  const placeholders = new Map(refs.map((id, index) => [id, placeholderFor({ index })]));
  const copy = replaceRefs({ value: args, placeholders });

  try {
    const parsedArgs = entry.inputShape === null ? copy : z.object(entry.inputShape).parse(copy);
    entry.validateArgs({ args: parsedArgs });
    return { refs, parsedArgs };
  } catch (error) {
    throw new ToolInputError(describeInputError({ error }));
  }
}

/** Refuses a ref that leads back to the proposal that holds it, directly or through its parents. */
export function assertNoRefCycle({
  proposalId,
  refs,
  dependsOnById,
}: {
  proposalId: string;
  refs: string[];
  dependsOnById: Map<string, string[]>;
}): void {
  const seen = new Set<string>();
  const stack = [...refs];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === proposalId) throw new ToolInputError('A proposal cannot depend on itself: the refs form a cycle');
    if (seen.has(id)) continue;

    seen.add(id);
    stack.push(...(dependsOnById.get(id) ?? []));
  }
}

/** Replaces each `$proposal:<id>` with the real id of the entity that card created. A ref with no id yet is left in place. */
export function substituteRefs({ value, ids }: { value: unknown; ids: Map<string, string> }): unknown {
  if (typeof value === 'string') {
    const id = PROPOSAL_REF_PATTERN.exec(value)?.[1];
    return (id && ids.get(id)) || value;
  }
  if (Array.isArray(value)) return value.map((item) => substituteRefs({ value: item, ids }));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteRefs({ value: item, ids })]));
  }
  return value;
}
