import { CHAT_ENTITY_KINDS, type ChatCardTitle, type ChatEntityKind, chatEntityLabelKey } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

const isEntityKind = (value: unknown): value is ChatEntityKind =>
  (CHAT_ENTITY_KINDS as readonly unknown[]).includes(value);

/**
 * Turns what the server sends as keys into text. The server never sends prose for a card, a warning
 * or a notice: it sends an i18n key and parameters, and the key may be one this build does not know
 * yet (a newer server), so every lookup has a way out that is not the raw key.
 */
export const useChatText = () => {
  const { t, te } = useI18n();

  /** The text of a key, or the text of `fallbackKey` (or `null`) when the key is not in the locale. */
  const keyText = ({
    key,
    params = {},
    fallbackKey,
  }: {
    key: string;
    params?: Record<string, string | number>;
    fallbackKey?: string;
  }): string | null => {
    if (te(key)) return t(key, params);
    return fallbackKey ? t(fallbackKey) : null;
  };

  /** The name of an entity kind, as it reads in the middle of a sentence ("budget plan"). */
  const entityText = ({ kind }: { kind: ChatEntityKind }): string => t(chatEntityLabelKey({ entity: kind }));

  /** The name of an entity kind to start a label with ("Budget plan"). */
  const entityLabel = ({ kind }: { kind: ChatEntityKind }): string => {
    const text = entityText({ kind });
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
  };

  /** A card title: its key with the entity kind in the parameter turned into the entity's name. */
  const titleText = ({ title }: { title: ChatCardTitle }): string => {
    const entity = title.params.entity;
    const named = isEntityKind(entity) ? entityText({ kind: entity }) : String(entity ?? '');
    return keyText({ key: title.key, params: { ...title.params, entity: named } }) ?? named;
  };

  /** The name of one option of an enum argument ("debitCard" as "Debit card"); an option with no name is shown as written. */
  const enumValueText = ({ path, value }: { path: string; value: string }): string =>
    keyText({ key: `chat.cards.enumValues.${path}.${value}` }) ?? value;

  return { keyText, entityText, entityLabel, titleText, enumValueText };
};
