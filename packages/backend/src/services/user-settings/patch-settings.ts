import {
  FIRE_HISTORY_BASELINE_MONTH,
  FIRE_HISTORY_MAX_ENTRIES,
  FIRE_VIEW_KEYS,
  type FireSettings,
} from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { type SettingsPatchSchema, type SettingsSchema, ZodSettingsSchema } from '@models/user-settings.model';
import isEqual from 'lodash/isEqual';
import omit from 'lodash/omit';

import { withTransaction } from '../common/with-transaction';
import { getOrCreateUserSettings } from './get-or-create-user-settings';
import { type RedactedSettingsSchema, redactKeyMaterial } from './redact-key-material';
import { mergeIntoStoredSettings, stripServiceOwnedSlices } from './service-owned-slices';

const withoutViewFields = ({ fire }: { fire: FireSettings | undefined }): FireSettings =>
  omit(fire ?? {}, FIRE_VIEW_KEYS);

/** Upserts the current month's snapshot. A change to view fields alone records nothing. */
const recordFireHistory = ({
  stored,
  merged,
}: {
  stored: SettingsSchema;
  merged: SettingsSchema;
}): SettingsSchema['fireHistory'] => {
  const previousFire = withoutViewFields({ fire: stored.fire });
  const nextFire = withoutViewFields({ fire: merged.fire });
  if (isEqual(previousFire, nextFire)) return stored.fireHistory;

  const month = new Date().toISOString().slice(0, 7);
  const history = stored.fireHistory?.length
    ? [...stored.fireHistory]
    : [{ month: FIRE_HISTORY_BASELINE_MONTH, fire: previousFire }];
  if (history.at(-1)?.month === month) history.pop();
  history.push({ month, fire: nextFire });

  return history.slice(-FIRE_HISTORY_MAX_ENTRIES);
};

/**
 * Applies a partial settings update: only keys present in `patch` change. Prefer it over the
 * full update endpoint, which sends the whole object and loses concurrent writes from other
 * tabs.
 */
export const patchUserSettings = withTransaction(
  async ({ userId, patch }: { userId: number; patch: SettingsPatchSchema }): Promise<RedactedSettingsSchema> => {
    const safePatch = stripServiceOwnedSlices({ settings: patch });

    // Ensure the row exists (race-safe), then serialize the read-modify-write:
    // FOR UPDATE when it already existed, or exclusive-by-being-uncommitted
    // (guarded by the unique index) when this call inserted it. A bare FOR
    // UPDATE can't help the first write for a fresh user — no row to lock yet.
    const [existing] = await getOrCreateUserSettings({ userId });

    const merged = mergeIntoStoredSettings({ stored: existing.settings, incoming: safePatch });

    const fireHistory = safePatch.fire ? recordFireHistory({ stored: existing.settings, merged }) : merged.fireHistory;

    // `fire` and `fireHistory` skip re-validation: the patched part is already validated, and a
    // stored value that fails a later-tightened limit must not break unrelated PATCHes.
    const parsed = ZodSettingsSchema.safeParse({ ...merged, fire: undefined, fireHistory: undefined });
    if (!parsed.success) {
      throw new ValidationError({
        message: 'Patched settings do not match the settings schema',
        details: { issues: parsed.error.issues },
      });
    }

    existing.settings = { ...parsed.data, fire: merged.fire, fireHistory };
    existing.changed('settings', true);
    await existing.save();

    return redactKeyMaterial({ settings: existing.settings });
  },
);
