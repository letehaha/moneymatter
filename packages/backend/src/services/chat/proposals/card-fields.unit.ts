import { describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { getToolCatalog } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { getModelSchema } from '../toolkit/model-schema';
import { describeField } from './card-fields';

const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';

describe('describeField', () => {
  it('shows an id argument that the policy maps to an entity as a record, for every write tool, nullable or not', () => {
    const misses: string[] = [];

    for (const entry of getToolCatalog().filter((tool) => tool.access === 'write')) {
      const policy = resolveToolPolicy({ name: entry.name, args: {} });
      const properties = (getModelSchema({ entry }).properties ?? {}) as Record<string, { type?: string }>;

      for (const [path, entityKind] of Object.entries(policy?.entityFields ?? {})) {
        const node = properties[path];
        if (!node) continue;
        const described = describeField({ key: path, value: node.type === 'array' ? [ID] : ID, node, entityKind });
        if (described.display?.kind !== 'entity') misses.push(`${entry.name}.${path}`);
      }
    }

    expect(misses).toEqual([]);
  });

  it('reads a UTC date and time or a date in a plain string argument as a date', () => {
    const node = { type: 'string' };

    expect(describeField({ key: 'time', value: '2026-10-19T07:26:00Z', node, entityKind: undefined }).display).toEqual({
      kind: 'datetime',
    });
    expect(describeField({ key: 'date', value: '2026-10-19', node, entityKind: undefined }).display).toEqual({
      kind: 'date',
    });
    expect(describeField({ key: 'time', value: '2026-10-19T07:26:00Z', node, entityKind: undefined }).editable).toEqual(
      {
        type: 'datetime',
      },
    );
    expect(describeField({ key: 'date', value: '2026-10-19', node, entityKind: undefined }).editable).toEqual({
      type: 'date',
    });
    expect(describeField({ key: 'note', value: 'Nord Coffee', node, entityKind: undefined }).display).toEqual({
      kind: 'text',
    });
  });

  it('reads the matching rules of a subscription as sentences and a list of presets as its options', () => {
    const rules = { rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }] };

    expect(
      describeField({ key: 'matchingRules', value: rules, node: { type: 'object' }, entityKind: undefined }),
    ).toEqual({
      display: { kind: 'matchingRules' },
      editable: null,
    });
    expect(
      describeField({
        key: 'remindBefore',
        value: ['3_days'],
        node: { type: 'array', items: { type: 'string', enum: ['0_days', '3_days'] } },
        entityKind: undefined,
      }),
    ).toEqual({ display: { kind: 'enum' }, editable: null });
  });
});
