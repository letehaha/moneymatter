import {
  NOTIFICATION_PUSH_GROUP,
  NOTIFICATION_TYPES,
  type Equals,
  type Expect,
  type NotificationType,
  PUSH_GROUPS,
  PUSH_GROUP_DEFAULTS,
  type PushGroup,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { isPushGroupEnabled } from './preferences';

// Compile-time: the map has exactly one entry per notification type and only valid groups.
export type PushGroupMapIsTotal = Expect<Equals<keyof typeof NOTIFICATION_PUSH_GROUP, NotificationType>>;
export type PushGroupDefaultsAreTotal = Expect<Equals<keyof typeof PUSH_GROUP_DEFAULTS, PushGroup>>;

describe('NOTIFICATION_PUSH_GROUP', () => {
  it('has an entry for every notification type, each in a known group', () => {
    const groups = new Set<string>(Object.values(PUSH_GROUPS));

    for (const type of Object.values(NOTIFICATION_TYPES)) {
      expect(groups.has(NOTIFICATION_PUSH_GROUP[type])).toBe(true);
    }
    expect(Object.keys(NOTIFICATION_PUSH_GROUP).toSorted()).toStrictEqual(Object.values(NOTIFICATION_TYPES).toSorted());
  });

  it('places every share_* and household_* type in sharing', () => {
    const sharingTypes = Object.values(NOTIFICATION_TYPES).filter(
      (type) => type.startsWith('share_') || type.startsWith('household_'),
    );

    expect(sharingTypes).toHaveLength(19);
    for (const type of sharingTypes) expect(NOTIFICATION_PUSH_GROUP[type]).toBe(PUSH_GROUPS.sharing);
  });

  it('groups the remaining types as the plan lists them', () => {
    expect(NOTIFICATION_PUSH_GROUP.subscription_reminder).toBe(PUSH_GROUPS.reminders);
    expect(NOTIFICATION_PUSH_GROUP.tag_reminder).toBe(PUSH_GROUPS.reminders);
    expect(NOTIFICATION_PUSH_GROUP.tracker_alert).toBe(PUSH_GROUPS.reminders);
    expect(NOTIFICATION_PUSH_GROUP.planned_confirmed).toBe(PUSH_GROUPS.bankSync);
    expect(NOTIFICATION_PUSH_GROUP.stuck_pending).toBe(PUSH_GROUPS.bankSync);
    expect(NOTIFICATION_PUSH_GROUP.system).toBe(PUSH_GROUPS.system);
    expect(NOTIFICATION_PUSH_GROUP.changelog).toBe(PUSH_GROUPS.releases);
  });
});

describe('isPushGroupEnabled', () => {
  it.each<[PushGroup, boolean]>([
    [PUSH_GROUPS.reminders, true],
    [PUSH_GROUPS.bankSync, true],
    [PUSH_GROUPS.sharing, true],
    [PUSH_GROUPS.system, true],
    [PUSH_GROUPS.releases, false],
  ])('defaults %s to %s when nothing is stored', (group, expected) => {
    expect(isPushGroupEnabled({ settings: { locale: 'en' }, group })).toBe(expected);
  });

  it('falls back to the defaults for a missing notifications key, null and undefined settings', () => {
    expect(isPushGroupEnabled({ settings: { locale: 'en' }, group: PUSH_GROUPS.reminders })).toBe(true);
    expect(isPushGroupEnabled({ settings: null, group: PUSH_GROUPS.reminders })).toBe(true);
    expect(isPushGroupEnabled({ settings: undefined, group: PUSH_GROUPS.releases })).toBe(false);
  });

  it('falls back to the default for a group that is not stored', () => {
    const settings = { locale: 'en' as const, notifications: { push: { groups: { reminders: false } } } };

    expect(isPushGroupEnabled({ settings, group: PUSH_GROUPS.sharing })).toBe(true);
    expect(isPushGroupEnabled({ settings, group: PUSH_GROUPS.releases })).toBe(false);
  });

  it('lets an explicit value win over the default in both directions', () => {
    const settings = {
      locale: 'en' as const,
      notifications: { push: { groups: { reminders: false, releases: true } } },
    };

    expect(isPushGroupEnabled({ settings, group: PUSH_GROUPS.reminders })).toBe(false);
    expect(isPushGroupEnabled({ settings, group: PUSH_GROUPS.releases })).toBe(true);
  });

  it('ignores the dormant notifications.enabled and types keys', () => {
    const settings = {
      locale: 'en' as const,
      notifications: { enabled: false, types: { tracker_alert: false, system: false, changelog: false } },
    };

    expect(isPushGroupEnabled({ settings, group: PUSH_GROUPS.system })).toBe(true);
  });
});
