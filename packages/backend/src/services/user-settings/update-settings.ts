import { type SettingsSchema } from '@models/user-settings.model';

import { withTransaction } from '../common/with-transaction';
import { getOrCreateUserSettings } from './get-or-create-user-settings';
import { type RedactedSettingsSchema, redactKeyMaterial } from './redact-key-material';
import { mergeIntoStoredSettings, stripServiceOwnedSlices } from './service-owned-slices';

type IncomingSettings = Omit<SettingsSchema, 'ai' | 'fire' | 'fireHistory'> & {
  ai?: Omit<NonNullable<SettingsSchema['ai']>, 'connections' | 'featureConfigs' | 'chat'>;
};

export const updateUserSettings = withTransaction(
  async ({ userId, settings }: { userId: number; settings: IncomingSettings }): Promise<RedactedSettingsSchema> => {
    // Stripped before `defaults` too: the first write seeds the new row straight from this
    // payload, with no stored settings to merge against.
    const incoming = stripServiceOwnedSlices({ settings });

    const [existingSettings, created] = await getOrCreateUserSettings({ userId, defaults: incoming });

    if (!created) {
      existingSettings.settings = mergeIntoStoredSettings({ stored: existingSettings.settings, incoming });
      existingSettings.changed('settings', true);
      await existingSettings.save();
    }

    return redactKeyMaterial({ settings: existingSettings.settings });
  },
);
