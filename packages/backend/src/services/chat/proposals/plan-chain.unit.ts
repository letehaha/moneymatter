import { describe, expect, it } from '@jest/globals';

import {
  confirmationMatches,
  findRevisionMismatch,
  planChain,
  strictestRequirement,
  type ChainRow,
} from './plan-chain';

const row = (id: string, overrides: Partial<ChainRow> = {}): ChainRow => ({
  id,
  status: 'pending',
  revision: 1,
  toolName: 'create_category',
  dependsOn: [],
  confirmation: 'none',
  confirmationPhrase: null,
  egressHost: null,
  ...overrides,
});

const rowsOf = (...rows: ChainRow[]) => new Map(rows.map((item) => [item.id, item]));
const isStandalone = ({ toolName }: { toolName: string }) =>
  ['change_base_currency', 'delete_import_batch'].includes(toolName);

describe('planChain', () => {
  it('orders a card after its parents, grandparents first', () => {
    const rows = rowsOf(
      row('tx', { dependsOn: ['category', 'tag'] }),
      row('category', { dependsOn: ['group'] }),
      row('tag'),
      row('group'),
    );

    const plan = planChain({ targetId: 'tx', rows, isStandalone });

    expect(plan).toEqual({ ok: true, order: ['group', 'category', 'tag', 'tx'], appliedParents: [] });
  });

  it('lists a parent shared by two refs once', () => {
    const rows = rowsOf(
      row('tx', { dependsOn: ['category', 'tag'] }),
      row('category', { dependsOn: ['group'] }),
      row('tag', { dependsOn: ['group'] }),
      row('group'),
    );

    const plan = planChain({ targetId: 'tx', rows, isStandalone });

    expect(plan).toMatchObject({ ok: true });
    expect(plan.ok && plan.order.filter((id) => id === 'group')).toHaveLength(1);
    expect(plan.ok && plan.order.at(-1)).toBe('tx');
  });

  it('plans a card with no parents as a chain of one', () => {
    expect(planChain({ targetId: 'a', rows: rowsOf(row('a')), isStandalone })).toEqual({
      ok: true,
      order: ['a'],
      appliedParents: [],
    });
  });

  it('keeps a parent an earlier approval applied out of the order and names it', () => {
    const rows = rowsOf(row('tx', { dependsOn: ['category'] }), row('category', { status: 'applied' }));

    expect(planChain({ targetId: 'tx', rows, isStandalone })).toEqual({
      ok: true,
      order: ['tx'],
      appliedParents: ['category'],
    });
  });

  it.each(['rejected', 'failed', 'expired', 'stale', 'blocked', 'superseded', 'applying', 'unknown'] as const)(
    'is blocked by a %s parent',
    (status) => {
      const rows = rowsOf(row('tx', { dependsOn: ['category'] }), row('category', { status }));

      expect(planChain({ targetId: 'tx', rows, isStandalone })).toEqual({
        ok: false,
        reason: 'notPending',
        proposalId: 'category',
        status,
      });
    },
  );

  it('is blocked by a bad grandparent', () => {
    const rows = rowsOf(
      row('tx', { dependsOn: ['category'] }),
      row('category', { dependsOn: ['group'] }),
      row('group', { status: 'rejected' }),
    );

    expect(planChain({ targetId: 'tx', rows, isStandalone })).toMatchObject({ ok: false, proposalId: 'group' });
  });

  it('reports a parent that no longer exists', () => {
    const rows = rowsOf(row('tx', { dependsOn: ['gone'] }));

    expect(planChain({ targetId: 'tx', rows, isStandalone })).toEqual({
      ok: false,
      reason: 'missing',
      proposalId: 'gone',
    });
  });

  it('refuses a target that is not pending itself', () => {
    const rows = rowsOf(row('tx', { status: 'stale' }));

    expect(planChain({ targetId: 'tx', rows, isStandalone })).toEqual({
      ok: false,
      reason: 'notPending',
      proposalId: 'tx',
      status: 'stale',
    });
  });

  it('refuses a standalone tool in a chain, as the card or as a parent', () => {
    const asCard = rowsOf(row('import', { toolName: 'delete_import_batch', dependsOn: ['category'] }), row('category'));
    const asParent = rowsOf(row('tx', { dependsOn: ['import'] }), row('import', { toolName: 'delete_import_batch' }));

    expect(planChain({ targetId: 'import', rows: asCard, isStandalone })).toMatchObject({
      ok: false,
      reason: 'standalone',
      proposalId: 'import',
    });
    expect(planChain({ targetId: 'tx', rows: asParent, isStandalone })).toMatchObject({
      ok: false,
      reason: 'standalone',
      proposalId: 'import',
    });
  });

  it('plans a standalone tool on its own', () => {
    const rows = rowsOf(row('import', { toolName: 'delete_import_batch' }));

    expect(planChain({ targetId: 'import', rows, isStandalone })).toMatchObject({ ok: true, order: ['import'] });
  });

  it('refuses refs that loop', () => {
    const rows = rowsOf(row('a', { dependsOn: ['b'] }), row('b', { dependsOn: ['a'] }));

    expect(planChain({ targetId: 'a', rows, isStandalone })).toMatchObject({ ok: false, reason: 'cycle' });
  });
});

describe('findRevisionMismatch', () => {
  const rows = rowsOf(row('tx', { revision: 3, dependsOn: ['category'] }), row('category', { revision: 2 }));
  const order = ['category', 'tx'];

  it('accepts the revisions the user saw', () => {
    expect(
      findRevisionMismatch({ order, rows, targetId: 'tx', revision: 3, parentRevisions: { category: 2 } }),
    ).toBeNull();
  });

  it('names the card whose revision moved on', () => {
    expect(findRevisionMismatch({ order, rows, targetId: 'tx', revision: 2, parentRevisions: { category: 2 } })).toBe(
      'tx',
    );
    expect(findRevisionMismatch({ order, rows, targetId: 'tx', revision: 3, parentRevisions: { category: 1 } })).toBe(
      'category',
    );
  });

  it('treats a parent revision the request did not send as a mismatch', () => {
    expect(findRevisionMismatch({ order, rows, targetId: 'tx', revision: 3, parentRevisions: {} })).toBe('category');
  });
});

describe('strictestRequirement', () => {
  it('asks for nothing when no card needs a confirmation', () => {
    expect(strictestRequirement({ rows: [row('a'), row('b')] })).toEqual({ mode: 'none' });
  });

  it('asks for a plain confirm on a single red card', () => {
    expect(strictestRequirement({ rows: [row('a', { confirmation: 'confirm' })] })).toEqual({ mode: 'confirm' });
  });

  it('asks an egress card to repeat its host', () => {
    expect(
      strictestRequirement({ rows: [row('a', { confirmation: 'confirm', egressHost: 'rates.example.com' })] }),
    ).toEqual({ mode: 'host', expected: 'rates.example.com' });
  });

  it('asks for the affected count on a typed card', () => {
    expect(strictestRequirement({ rows: [row('a', { confirmation: 'typed', confirmationPhrase: '12' })] })).toEqual({
      mode: 'typed',
      expected: '12',
    });
  });

  it('takes the strictest card of the chain: typed over host over confirm', () => {
    const confirm = row('a', { confirmation: 'confirm' });
    const host = row('b', { confirmation: 'confirm', egressHost: 'x.example' });
    const typed = row('c', { confirmation: 'typed', confirmationPhrase: '3' });

    expect(strictestRequirement({ rows: [confirm, host] })).toEqual({ mode: 'host', expected: 'x.example' });
    expect(strictestRequirement({ rows: [confirm, host, typed] })).toEqual({ mode: 'typed', expected: '3' });
  });

  it('falls back to a plain confirm for a typed card that stored no count', () => {
    expect(strictestRequirement({ rows: [row('a', { confirmation: 'typed', confirmationPhrase: null })] })).toEqual({
      mode: 'confirm',
    });
  });
});

describe('confirmationMatches', () => {
  it('accepts anything when nothing is asked', () => {
    expect(confirmationMatches({ requirement: { mode: 'none' }, confirmation: undefined })).toBe(true);
  });

  it('wants the word confirm, in any case', () => {
    expect(confirmationMatches({ requirement: { mode: 'confirm' }, confirmation: 'Confirm' })).toBe(true);
    expect(confirmationMatches({ requirement: { mode: 'confirm' }, confirmation: 'yes' })).toBe(false);
    expect(confirmationMatches({ requirement: { mode: 'confirm' }, confirmation: undefined })).toBe(false);
  });

  it('wants the host repeated, ignoring case and spaces', () => {
    const requirement = { mode: 'host', expected: 'rates.example.com' } as const;

    expect(confirmationMatches({ requirement, confirmation: ' Rates.Example.com ' })).toBe(true);
    expect(confirmationMatches({ requirement, confirmation: 'example.com' })).toBe(false);
    expect(confirmationMatches({ requirement, confirmation: 'confirm' })).toBe(false);
  });

  it('wants the exact count', () => {
    const requirement = { mode: 'typed', expected: '12' } as const;

    expect(confirmationMatches({ requirement, confirmation: '12' })).toBe(true);
    expect(confirmationMatches({ requirement, confirmation: ' 12 ' })).toBe(true);
    expect(confirmationMatches({ requirement, confirmation: '120' })).toBe(false);
    expect(confirmationMatches({ requirement, confirmation: 'confirm' })).toBe(false);
  });
});
