import { listAccountGroupPaths } from '@/components/sidebar/accounts-view/helpers/list-account-group-paths';
import { ACCOUNT_STATUSES, type AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { makeGroup } from '../test-fixtures';
import { buildAddAccountsSections, filterAddAccountsSections } from './build-add-accounts-sections';

const makeAccount = ({
  id,
  name,
  status = ACCOUNT_STATUSES.active,
}: {
  id: string;
  name: string;
  status?: ACCOUNT_STATUSES;
}) => ({ id, name, status }) as AccountModel;

const cash = makeAccount({ id: 'acc-1', name: 'Cash' });
const monoBlack = makeAccount({ id: 'acc-2', name: 'Mono black' });
const monoWhite = makeAccount({ id: 'acc-3', name: 'Mono white' });
const savings = makeAccount({ id: 'acc-4', name: 'Savings' });
const archived = makeAccount({ id: 'acc-5', name: 'Old card', status: ACCOUNT_STATUSES.archived });

const ukraine = makeGroup({ id: 'ukraine', accounts: [monoBlack] });
const personal = makeGroup({ id: 'personal', accounts: [savings], childGroups: [ukraine] });
const entries = listAccountGroupPaths({ groups: [personal] });

const build = ({ groupId = 'personal' }: { groupId?: string } = {}) =>
  buildAddAccountsSections({ accounts: [cash, monoBlack, monoWhite, savings, archived], entries, groupId });

describe('buildAddAccountsSections', () => {
  it('splits accounts into ungrouped, other groups and the target group', () => {
    const sections = build();

    expect(sections.ungrouped).toEqual([cash, monoWhite]);
    expect(sections.alreadyInGroup).toEqual([savings]);
    expect(sections.inOtherGroups).toEqual([
      { account: monoBlack, groupId: 'ukraine', groupName: 'ukraine', path: 'personal / ukraine' },
    ]);
  });

  it('treats an account in a subgroup as belonging to that subgroup, not its parent', () => {
    expect(build({ groupId: 'ukraine' }).inOtherGroups.map(({ account }) => account)).toEqual([savings]);
  });

  it('leaves archived accounts out', () => {
    const { ungrouped, inOtherGroups, alreadyInGroup } = build();

    expect([...ungrouped, ...inOtherGroups.map(({ account }) => account), ...alreadyInGroup]).not.toContain(archived);
  });
});

describe('filterAddAccountsSections', () => {
  it('filters every section by a case-insensitive, trimmed name match', () => {
    const sections = filterAddAccountsSections({ sections: build(), query: '  MONO ' });

    expect(sections.ungrouped).toEqual([monoWhite]);
    expect(sections.inOtherGroups.map(({ account }) => account)).toEqual([monoBlack]);
    expect(sections.alreadyInGroup).toEqual([]);
  });

  it('does not match on account ids', () => {
    expect(filterAddAccountsSections({ sections: build(), query: 'acc-' })).toEqual({
      ungrouped: [],
      inOtherGroups: [],
      alreadyInGroup: [],
    });
  });

  it('returns the sections untouched for a blank query', () => {
    const sections = build();

    expect(filterAddAccountsSections({ sections, query: '  ' })).toBe(sections);
  });
});
