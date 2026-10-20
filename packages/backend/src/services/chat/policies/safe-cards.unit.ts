import type { ChatCardField, ChatProposalCard } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { isSafeForApproveAll } from './safe-cards';

let nextId = 0;

const makeCard = (overrides: Partial<ChatProposalCard> = {}): ChatProposalCard => ({
  id: `card-${++nextId}`,
  status: 'pending',
  revision: 1,
  toolName: 'create_transaction',
  kind: 'create',
  entity: 'transaction',
  danger: 'none',
  confirmation: { mode: 'none' },
  title: { key: 'chat.cards.title.create', params: {} },
  fields: [],
  dependsOn: [],
  safe: false,
  warnings: [],
  sources: [],
  canApply: { ok: true },
  editedByUser: false,
  createdAt: '2026-10-18T10:00:00.000Z',
  expiresAt: '2026-10-19T10:00:00.000Z',
  ...overrides,
});

const field = (overrides: Partial<ChatCardField> = {}): ChatCardField => ({
  path: 'amount',
  labelKey: 'chat.fields.amount',
  value: 10,
  editable: null,
  ...overrides,
});

const dependency = ({ card }: { card: ChatProposalCard }) => ({
  id: card.id,
  title: card.title,
  status: card.status,
  revision: card.revision,
});

describe('isSafeForApproveAll', () => {
  it('accepts a plain pending create card', () => {
    const card = makeCard();

    expect(isSafeForApproveAll({ card, cards: [card] })).toBe(true);
  });

  it.each([
    'applying',
    'applied',
    'rejected',
    'failed',
    'stale',
    'blocked',
    'superseded',
    'expired',
    'unknown',
  ] as const)('rejects a card whose status is %s', (status) => {
    const card = makeCard({ status });

    expect(isSafeForApproveAll({ card, cards: [card] })).toBe(false);
  });

  it.each([
    ['destructive danger', { danger: 'destructive', confirmation: { mode: 'confirm' } }],
    ['high-impact danger', { danger: 'highImpact', confirmation: { mode: 'typed', phrase: '3' } }],
    ['a danger level with no confirmation', { danger: 'destructive' }],
    ['a confirmation with no danger', { confirmation: { mode: 'confirm' } }],
    ['an egress target', { egress: { url: 'https://rates.example.com/{code}', host: 'rates.example.com' } }],
    ['the settings kind', { kind: 'settings', toolName: 'update_user_settings', entity: 'userSettings' }],
    ['a stale snapshot', { stale: { reasonKey: 'chat.stale.changed' } }],
    ['a card that cannot be applied', { canApply: { ok: false, reasonKey: 'chat.cards.previewPending' } }],
    ['an uncertain field', { fields: [field({ uncertain: { reason: 'guessedFromHistory' } })] }],
    ['a standalone tool', { toolName: 'delete_import_batch', kind: 'delete', entity: 'importBatch' }],
    ['a tool the policies do not know', { toolName: 'frobnicate' }],
  ] as Array<[string, Partial<ChatProposalCard>]>)('rejects a card with %s', (_label, overrides) => {
    const card = makeCard(overrides);

    expect(isSafeForApproveAll({ card, cards: [card] })).toBe(false);
  });

  it('ignores the card own safe flag', () => {
    const card = makeCard({ safe: true, danger: 'destructive', confirmation: { mode: 'confirm' } });

    expect(isSafeForApproveAll({ card, cards: [card] })).toBe(false);
  });

  describe('parents', () => {
    it('accepts a card whose pending parent is safe', () => {
      const parent = makeCard({ toolName: 'create_category', entity: 'category' });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [parent, card] })).toBe(true);
    });

    it('rejects a card whose pending parent is not safe', () => {
      const parent = makeCard({
        toolName: 'set_currency_rate_source',
        kind: 'update',
        entity: 'customCurrency',
        egress: { url: 'https://rates.example.com/{code}', host: 'rates.example.com' },
      });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [parent, card] })).toBe(false);
    });

    it('rejects a card whose pending grandparent is not safe', () => {
      const grandparent = makeCard({ canApply: { ok: false, reasonKey: 'chat.cards.previewPending' } });
      const parent = makeCard({
        toolName: 'create_category',
        entity: 'category',
        dependsOn: [dependency({ card: grandparent })],
      });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [grandparent, parent, card] })).toBe(false);
    });

    it('rejects a card whose pending parent is missing from the list', () => {
      const parent = makeCard({ toolName: 'create_category', entity: 'category' });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [card] })).toBe(false);
    });

    it('does not look at a parent that is already applied', () => {
      const parent = makeCard({ status: 'applied', danger: 'destructive' });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [card] })).toBe(true);
    });

    it('rejects a card whose parent was rejected', () => {
      const parent = makeCard({ status: 'rejected' });
      const card = makeCard({ dependsOn: [dependency({ card: parent })] });

      expect(isSafeForApproveAll({ card, cards: [parent, card] })).toBe(false);
    });

    it('ends on a dependency cycle instead of looping', () => {
      const first = makeCard();
      const second = makeCard({ dependsOn: [dependency({ card: first })] });
      first.dependsOn = [dependency({ card: second })];

      expect(isSafeForApproveAll({ card: first, cards: [first, second] })).toBe(false);
    });
  });
});
