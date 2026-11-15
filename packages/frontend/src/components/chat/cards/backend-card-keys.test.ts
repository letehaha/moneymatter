import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import ukChat from '@/i18n/locales/chunks/uk/pages/chat.json';
import type { ChatCardConflictReason } from '@bt/shared/types';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The chat services of the backend, which emit i18n keys that cards, notices, warnings and run errors carry to the client. */
const BACKEND_CHAT_DIR = `${resolve(import.meta.dirname, '../../../../../backend/src/services/chat')}/`;

/** The families the client renders: a card and the parts around it, and a failed run. */
const EMITTED_KEY = /['"`](chat\.(?:cards|stale|warnings|notices|errors)\.[A-Za-z0-9_.]+)['"`]/g;

/** `describeRunFailure` builds `chat.errors.${code}` from the code it passes to `failure({ code })`. */
const RUN_FAILURE_CODE = /failure\(\{ code: '([A-Za-z]+)' \}\)/g;

const isTestFile = ({ path }: { path: string }) => /\.(unit|e2e|test|spec)\.ts$/.test(path);

const sourceFiles = ({ dir }: { dir: string }): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles({ dir: `${path}/` });
    return entry.name.endsWith('.ts') && !isTestFile({ path }) ? [path] : [];
  });

const readEmittedKeys = (): Map<string, string> => {
  const found = new Map<string, string>();
  const remember = ({ key, path }: { key: string; path: string }) => {
    if (!found.has(key)) found.set(key, path.replace(BACKEND_CHAT_DIR, ''));
  };

  for (const path of sourceFiles({ dir: BACKEND_CHAT_DIR })) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(EMITTED_KEY)) remember({ key: match[1]!, path });
    for (const match of source.matchAll(RUN_FAILURE_CODE)) remember({ key: `chat.errors.${match[1]!}`, path });
  }
  return found;
};

/** The previews that fill `counts`; each count is a `<name>Count` key the card labels as `chat.cards.counts.items.<name>Count`. */
const PREVIEWS_DIR = `${BACKEND_CHAT_DIR}proposals/previews/`;

/** `*Count` names in the previews that are not related counts. */
const NOT_RELATED_COUNTS = new Set(['affectedCount', 'targetCount']);

const readCountKeys = (): string[] =>
  [
    ...new Set(
      sourceFiles({ dir: PREVIEWS_DIR }).flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(/\b([a-z][A-Za-z]*Count)\b/g)].map((match) => match[1]!),
      ),
    ),
  ].filter((name) => !NOT_RELATED_COUNTS.has(name));

/**
 * `approve-all.ts` builds `chat.cards.${details.reason}` from the conflict reason of a 409. The record
 * is typed against the shared union, so a new reason fails the build until it is listed here.
 */
const CONFLICT_REASON_KEYS: Record<ChatCardConflictReason, true> = {
  revision: true,
  notPending: true,
  blocked: true,
  expired: true,
  stale: true,
  unavailable: true,
};

const readKey = ({ messages, key }: { messages: unknown; key: string }): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

const missingFrom = ({ messages, keys }: { messages: unknown; keys: string[] }) =>
  keys.filter((key) => {
    const text = readKey({ messages, key });
    return typeof text !== 'string' || text.trim() === '';
  });

describe('keys the backend emits for cards', () => {
  const emitted = readEmittedKeys();
  const keys = [
    ...new Set([...emitted.keys(), ...Object.keys(CONFLICT_REASON_KEYS).map((reason) => `chat.cards.${reason}`)]),
  ].sort();

  it('finds the keys in the backend source', () => {
    // A moved folder or a changed pattern must not leave this suite checking nothing.
    expect(emitted.size).toBeGreaterThan(40);
    expect([...emitted.keys()]).toEqual(
      expect.arrayContaining([
        'chat.cards.previewPending',
        'chat.cards.columns.payee',
        'chat.stale.updated',
        'chat.warnings.egress',
        'chat.notices.stepLimit',
        'chat.errors.timeout',
        'chat.errors.rateLimited',
      ]),
    );
  });

  it('finds the related counts the previews fill', () => {
    expect(readCountKeys()).toEqual(expect.arrayContaining(['transactionCount', 'splitCount', 'transferTwinCount']));
  });

  it('has a label in both locales for every related count a preview fills', () => {
    const labelKeys = readCountKeys().map((name) => `chat.cards.counts.items.${name}`);

    expect(missingFrom({ messages: enChat, keys: labelKeys })).toEqual([]);
    expect(missingFrom({ messages: ukChat, keys: labelKeys })).toEqual([]);
  });

  it('has every key in the en locale', () => {
    const missing = missingFrom({ messages: enChat, keys }).map(
      (key) => `${key} (${emitted.get(key) ?? 'built or named outside a literal'})`,
    );

    expect(missing).toEqual([]);
  });

  it('has every key in the uk locale', () => {
    expect(missingFrom({ messages: ukChat, keys })).toEqual([]);
  });
});
