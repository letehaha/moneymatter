import { describe, expect, it } from '@jest/globals';

import { MAX_AI_GROUPS, MAX_AI_LINES, sanitizeLayout } from './suggested-lines-ai';

const categories = [
  { id: 'food', parentId: null },
  { id: 'groceries', parentId: 'food' },
  { id: 'restaurant', parentId: 'food' },
  { id: 'housing', parentId: null },
  { id: 'rent', parentId: 'housing' },
  { id: 'fuel', parentId: null },
];
const byId = new Map(categories.map((category) => [category.id, category]));
const candidates = [
  { id: 'food', path: 'Food', totalCents: 105000 },
  { id: 'groceries', path: 'Food › Groceries', totalCents: 90000 },
  { id: 'restaurant', path: 'Food › Restaurant', totalCents: 15000 },
  { id: 'rent', path: 'Housing › Rent', totalCents: 100000 },
  { id: 'fuel', path: 'Fuel', totalCents: 0 },
];

describe('sanitizeLayout', () => {
  it('drops unknown and repeated ids, zero-spend-only lines and empty groups', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      layout: {
        groups: [
          { name: ' Home ', lines: [{ name: 'Rent', categoryIds: ['rent', 'rent', 'bogus'] }] },
          {
            name: 'Everyday',
            lines: [
              { name: 'Food', categoryIds: ['groceries', 'restaurant', 'fuel'] },
              { name: 'Car', categoryIds: ['fuel'] },
            ],
          },
          { name: 'Ghost', lines: [{ name: 'Nothing', categoryIds: ['bogus'] }] },
        ],
      },
    });

    expect(layout).toEqual({
      groups: [
        { name: 'Home', lines: [{ name: 'Rent', categoryIds: ['rent'] }] },
        { name: 'Everyday', lines: [{ name: 'Food', categoryIds: ['groceries', 'restaurant', 'fuel'] }] },
      ],
    });
  });

  it('keeps the first line when another one holds an ancestor or descendant', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      layout: {
        groups: [
          {
            name: 'Everyday',
            lines: [
              { name: 'Groceries', categoryIds: ['groceries'] },
              { name: 'All food', categoryIds: ['food', 'restaurant'] },
            ],
          },
        ],
      },
    });

    expect(layout.groups[0]!.lines).toEqual([
      { name: 'Groceries', categoryIds: ['groceries'] },
      { name: 'All food', categoryIds: ['restaurant'] },
    ]);
  });

  it('drops a line held by an ancestor an earlier line took', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      layout: {
        groups: [
          {
            name: 'Everyday',
            lines: [
              { name: 'All food', categoryIds: ['food'] },
              { name: 'Groceries', categoryIds: ['groceries'] },
            ],
          },
        ],
      },
    });

    expect(layout.groups[0]!.lines).toEqual([{ name: 'All food', categoryIds: ['food'] }]);
  });

  it('keeps a line listing only a parent whose spend sits on its children', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      layout: { groups: [{ name: 'Everyday', lines: [{ name: 'Food', categoryIds: ['food'] }] }] },
    });

    expect(layout).toEqual({ groups: [{ name: 'Everyday', lines: [{ name: 'Food', categoryIds: ['food'] }] }] });
  });

  it('drops a group or line whose name is blank', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      layout: {
        groups: [
          { name: '  ', lines: [{ name: 'Rent', categoryIds: ['rent'] }] },
          {
            name: 'Everyday',
            lines: [
              { name: ' ', categoryIds: ['groceries'] },
              { name: 'Rent', categoryIds: ['rent'] },
            ],
          },
        ],
      },
    });

    expect(layout).toEqual({ groups: [{ name: 'Everyday', lines: [{ name: 'Rent', categoryIds: ['rent'] }] }] });
  });

  it('caps the number of groups', () => {
    const many = Array.from({ length: MAX_AI_GROUPS + 2 }, (_, index) => ({
      id: `c${index}`,
      path: `C${index}`,
      totalCents: 1000,
    }));
    const layout = sanitizeLayout({
      byId: new Map(many.map((candidate) => [candidate.id, { id: candidate.id, parentId: null }])),
      candidates: many,
      layout: { groups: many.map(({ id }) => ({ name: id, lines: [{ name: id, categoryIds: [id] }] })) },
    });

    expect(layout.groups.map((group) => group.name)).toEqual(many.slice(0, MAX_AI_GROUPS).map(({ id }) => id));
  });

  it('caps the number of lines', () => {
    const many = Array.from({ length: MAX_AI_LINES + 3 }, (_, index) => ({
      id: `c${index}`,
      path: `C${index}`,
      totalCents: 1000,
    }));
    const layout = sanitizeLayout({
      byId: new Map(many.map((candidate) => [candidate.id, { id: candidate.id, parentId: null }])),
      candidates: many,
      layout: { groups: [{ name: 'All', lines: many.map(({ id }) => ({ name: id, categoryIds: [id] })) }] },
    });

    expect(layout.groups[0]!.lines).toHaveLength(MAX_AI_LINES);
  });

  it('caps the lines at `maxLines` when given', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      maxLines: 1,
      layout: {
        groups: [
          {
            name: 'All',
            lines: [
              { name: 'Rent', categoryIds: ['rent'] },
              { name: 'Food', categoryIds: ['food'] },
            ],
          },
        ],
      },
    });

    expect(layout.groups[0]!.lines).toEqual([{ name: 'Rent', categoryIds: ['rent'] }]);
  });

  it('keeps a zero-spend line without `requireSpend`, but never an empty one', () => {
    const layout = sanitizeLayout({
      byId,
      candidates,
      requireSpend: false,
      layout: {
        groups: [
          {
            name: 'Everyday',
            lines: [
              { name: 'Car', categoryIds: ['fuel'] },
              { name: 'Nothing', categoryIds: ['bogus'] },
            ],
          },
        ],
      },
    });

    expect(layout).toEqual({ groups: [{ name: 'Everyday', lines: [{ name: 'Car', categoryIds: ['fuel'] }] }] });
  });
});
