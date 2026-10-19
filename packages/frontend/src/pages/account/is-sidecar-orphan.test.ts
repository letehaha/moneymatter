import { ACCOUNT_CATEGORIES, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { isGenuineSidecarOrphan } from './is-sidecar-orphan';

const id = (value: string) => value as RecordId;

const vehicleAccount = { id: id('acc-vehicle'), accountCategory: ACCOUNT_CATEGORIES.vehicle };
const propertyAccount = { id: id('acc-property'), accountCategory: ACCOUNT_CATEGORIES.property };
const generalAccount = { id: id('acc-general'), accountCategory: ACCOUNT_CATEGORIES.general };

describe('isGenuineSidecarOrphan', () => {
  it('returns false for a ghost — id absent from the live accounts list', () => {
    // No sidecar match, but the account is gone from the live list — not an orphan.
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-vehicle'),
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [generalAccount],
        sidecarRecords: [{ accountId: id('acc-other') }],
      }),
    ).toBe(false);
  });

  it('returns true for a genuine orphan — sidecar account present in the live list with no matching record', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-vehicle'),
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [vehicleAccount],
        sidecarRecords: [{ accountId: id('acc-other') }],
      }),
    ).toBe(true);
  });

  it('returns false when a sidecar record matches the account', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-vehicle'),
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [vehicleAccount],
        sidecarRecords: [{ accountId: id('acc-vehicle') }],
      }),
    ).toBe(false);
  });

  it('returns false when the live account is of a different category', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-general'),
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [generalAccount],
        sidecarRecords: [],
      }),
    ).toBe(false);
  });

  it('does not treat a property account as a vehicle orphan', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-property'),
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [propertyAccount],
        sidecarRecords: [],
      }),
    ).toBe(false);
  });

  it('detects a genuine property orphan', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: id('acc-property'),
        category: ACCOUNT_CATEGORIES.property,
        liveAccounts: [propertyAccount],
        sidecarRecords: [{ accountId: id('acc-other') }],
      }),
    ).toBe(true);
  });

  it('returns false when no account id is provided', () => {
    expect(
      isGenuineSidecarOrphan({
        accountId: undefined,
        category: ACCOUNT_CATEGORIES.vehicle,
        liveAccounts: [vehicleAccount],
        sidecarRecords: [],
      }),
    ).toBe(false);
  });
});
