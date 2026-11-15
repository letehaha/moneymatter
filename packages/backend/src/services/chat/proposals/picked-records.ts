import type { ChatEntityKind } from '@bt/shared/types';

import type { PickedRecord } from '../prompt/picked-records';
import { isProposalRef, ToolInputError } from './placeholders';

const idsOf = ({ value }: { value: unknown }): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string' && !isProposalRef({ value: item }),
  );

/**
 * A card that names a record of a kind the user just picked (the account they tapped in the model's own question)
 * must name one they picked. The model writes the id itself, and an id that differs from the tapped option ends in
 * a card on the wrong account, so the call is refused with the id the user chose.
 */
export function assertCardUsesPickedRecords({
  picked,
  entityFields,
  args,
}: {
  picked: PickedRecord[];
  entityFields: Record<string, ChatEntityKind>;
  args: Record<string, unknown>;
}): void {
  for (const kind of new Set(picked.map((record) => record.kind))) {
    const chosen = picked.filter((record) => record.kind === kind);
    const used = Object.entries(entityFields)
      .filter(([, entityKind]) => entityKind === kind)
      .flatMap(([field]) => (field in args ? idsOf({ value: args[field] }) : []));
    if (used.length === 0 || used.some((id) => chosen.some((record) => record.id === id))) continue;

    throw new ToolInputError(
      `The user picked ${chosen.map((record) => `${record.label} (${kind} id ${record.id})`).join(' or ')} when you asked, but this card uses ${used.join(', ')}. Use the ${kind} id the user picked, or ask again if you meant another.`,
    );
  }
}
