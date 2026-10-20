import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import ukChat from '@/i18n/locales/chunks/uk/pages/chat.json';
import {
  CHAT_CARD_KINDS,
  CHAT_ENTITY_KINDS,
  CHAT_FIELD_LABEL_KEYS,
  chatCardTitleKey,
  chatEntityLabelKey,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

const LOCALES = [
  { locale: 'en', messages: enChat },
  { locale: 'uk', messages: ukChat },
] as const;

/** Reads a dotted key out of a nested message object. */
const readKey = ({ messages, key }: { messages: unknown; key: string }): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

describe('chat i18n keys', () => {
  describe.each(LOCALES)('$locale', ({ messages }) => {
    it.each(Object.entries(CHAT_FIELD_LABEL_KEYS))('has the field label %s', (_field, key) => {
      expect(readKey({ messages, key })).toEqual(expect.any(String));
      expect(readKey({ messages, key })).not.toBe('');
    });

    it.each(CHAT_ENTITY_KINDS)('has the entity name %s', (entity) => {
      expect(readKey({ messages, key: chatEntityLabelKey({ entity }) })).toEqual(expect.any(String));
    });

    it.each(CHAT_CARD_KINDS)('has the card title for %s with an {entity} placeholder', (kind) => {
      const title = readKey({ messages, key: chatCardTitleKey({ kind }) });

      expect(title).toEqual(expect.stringContaining('{entity}'));
    });
  });

  it('keeps every field label key under chat.fields', () => {
    for (const [field, key] of Object.entries(CHAT_FIELD_LABEL_KEYS)) {
      expect(key).toBe(`chat.fields.${field}`);
    }
  });

  it('translates the uk labels instead of copying the en text', () => {
    const copied = Object.values(CHAT_FIELD_LABEL_KEYS).filter(
      (key) => readKey({ messages: ukChat, key }) === readKey({ messages: enChat, key }),
    );

    // Terms such as "Carry" or "SPV subtype" stay close to the source; a long run means a copy-paste.
    expect(copied.length).toBeLessThan(10);
  });
});
