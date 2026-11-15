import { describe, expect, it } from 'vitest';

import {
  collectPendingParents,
  confirmationFor,
  isTypedConfirmationMet,
  parentRevisionsOf,
  requirementOfChain,
} from './card-chain';
import { buildCard } from './card-test-fixtures';

const link = ({
  id,
  revision = 1,
  status = 'pending' as const,
}: {
  id: string;
  revision?: number;
  status?: 'pending' | 'applied';
}) => ({
  id,
  revision,
  status,
  title: { key: 'chat.cards.title.create', params: { entity: 'category' } },
});

describe('collectPendingParents', () => {
  it('returns no parents for a card without dependencies', () => {
    expect(collectPendingParents({ card: buildCard(), cards: {} })).toEqual([]);
  });

  it('lists the pending parents with the revision of the card on the page', () => {
    const parent = buildCard({ id: 'parent', revision: 4 });
    const card = buildCard({ dependsOn: [link({ id: 'parent', revision: 2 })] });

    const parents = collectPendingParents({ card, cards: { parent } });

    expect(parents.map((item) => [item.id, item.revision])).toEqual([['parent', 4]]);
  });

  it('falls back to the revision of the link when the parent card is not on the page', () => {
    const card = buildCard({ dependsOn: [link({ id: 'parent', revision: 3 })] });

    expect(parentRevisionsOf({ parents: collectPendingParents({ card, cards: {} }) })).toEqual({ parent: 3 });
  });

  it('leaves out parents that are no longer pending', () => {
    const card = buildCard({ dependsOn: [link({ id: 'done', status: 'applied' }), link({ id: 'open' })] });

    expect(collectPendingParents({ card, cards: {} }).map((item) => item.id)).toEqual(['open']);
  });

  it('follows parents of parents, nearest first, and visits each card once', () => {
    const grandparent = buildCard({ id: 'grandparent', revision: 7 });
    const parent = buildCard({ id: 'parent', dependsOn: [link({ id: 'grandparent' })] });
    const card = buildCard({ dependsOn: [link({ id: 'parent' }), link({ id: 'grandparent' })] });

    const parents = collectPendingParents({ card, cards: { parent, grandparent } });

    expect(parents.map((item) => item.id)).toEqual(['parent', 'grandparent']);
    expect(parentRevisionsOf({ parents })).toEqual({ parent: 1, grandparent: 7 });
  });
});

describe('requirementOfChain', () => {
  it('needs nothing for a plain card', () => {
    expect(requirementOfChain({ card: buildCard(), parents: [] })).toEqual({ mode: 'none' });
  });

  it('asks for a single confirmation on a red card', () => {
    const card = buildCard({ danger: 'destructive', confirmation: { mode: 'confirm' } });

    expect(requirementOfChain({ card, parents: [] })).toEqual({ mode: 'confirm' });
  });

  it('asks for the host of an egress card', () => {
    const card = buildCard({ egress: { url: 'https://rates.example.com/{pair}', host: 'rates.example.com' } });

    expect(requirementOfChain({ card, parents: [] })).toEqual({ mode: 'host', expected: 'rates.example.com' });
  });

  it('asks for the typed count on a bulk card', () => {
    const card = buildCard({ danger: 'destructive', confirmation: { mode: 'typed', phrase: '42' } });

    expect(requirementOfChain({ card, parents: [] })).toEqual({ mode: 'typed', expected: '42' });
  });

  it('takes the strictest requirement of the card and its known parents', () => {
    const parentCard = buildCard({ id: 'parent', confirmation: { mode: 'typed', phrase: '7' } });
    const card = buildCard({ egress: { url: 'https://a.example.com/x', host: 'a.example.com' } });
    const parents = collectPendingParents({
      card: { ...card, dependsOn: [link({ id: 'parent' })] },
      cards: { parent: parentCard },
    });

    expect(requirementOfChain({ card, parents })).toEqual({ mode: 'typed', expected: '7' });
  });
});

describe('confirmationFor and isTypedConfirmationMet', () => {
  it('sends nothing, the word, the host or the typed text by requirement', () => {
    expect(confirmationFor({ requirement: { mode: 'none' }, typed: '' })).toBeUndefined();
    expect(confirmationFor({ requirement: { mode: 'confirm' }, typed: '' })).toBe('confirm');
    expect(confirmationFor({ requirement: { mode: 'host', expected: 'a.example.com' }, typed: '' })).toBe(
      'a.example.com',
    );
    expect(confirmationFor({ requirement: { mode: 'typed', expected: '42' }, typed: ' 42 ' })).toBe('42');
  });

  it('accepts only the expected count for a typed requirement', () => {
    const requirement = { mode: 'typed' as const, expected: '42' };

    expect(isTypedConfirmationMet({ requirement, typed: '41' })).toBe(false);
    expect(isTypedConfirmationMet({ requirement, typed: '' })).toBe(false);
    expect(isTypedConfirmationMet({ requirement, typed: ' 42 ' })).toBe(true);
    expect(isTypedConfirmationMet({ requirement: { mode: 'confirm' }, typed: '' })).toBe(true);
  });
});
