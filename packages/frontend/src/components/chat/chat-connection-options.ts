import type { AIConnectionInfo } from '@bt/shared/types';

/** Connection ids are UUIDs, so this never collides with one. */
export const INCLUDED_OPTION_VALUE = 'included';

export type ChatConnectionOption =
  | { value: typeof INCLUDED_OPTION_VALUE; kind: 'included'; connectionId: null }
  | { value: string; kind: 'connection'; connectionId: string; name: string; model: string; needsAttention: boolean };

/**
 * What the chat's model picker offers: every connection of the user in their saved order, then the
 * included model where one serves chat.
 */
export const buildChatConnectionOptions = ({
  connections,
  hasIncludedModel,
}: {
  connections: AIConnectionInfo[];
  hasIncludedModel: boolean;
}): ChatConnectionOption[] => [
  ...connections.map(
    (connection): ChatConnectionOption => ({
      value: connection.id,
      kind: 'connection',
      connectionId: connection.id,
      name: connection.name,
      model: connection.model,
      needsAttention: connection.status === 'invalid',
    }),
  ),
  ...(hasIncludedModel
    ? [{ value: INCLUDED_OPTION_VALUE, kind: 'included', connectionId: null } satisfies ChatConnectionOption]
    : []),
];

/**
 * The option a thread's connection id selects. Null is the included model, which is no selection while
 * none serves chat; an id that is not in the list (a connection deleted since) selects nothing.
 */
export const findSelectedChatConnectionOption = ({
  options,
  connectionId,
}: {
  options: ChatConnectionOption[];
  connectionId: string | null;
}): ChatConnectionOption | null => options.find((option) => option.connectionId === connectionId) ?? null;
