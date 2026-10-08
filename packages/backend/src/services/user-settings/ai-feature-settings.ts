import { AIFeatureConfig, AI_FEATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { DEFAULT_SETTINGS, SettingsSchema } from '@models/user-settings.model';

import { getServerModel } from '../ai/resolution-ladder';
import { withTransaction } from '../common/with-transaction';
import { getOrCreateUserSettings } from './get-or-create-user-settings';

/**
 * `config: null` clears the feature's pick. The connection is checked against the locked row,
 * so a concurrent delete can't leave a dangling pick.
 */
const storeFeatureConfig = withTransaction(
  async ({
    userId,
    feature,
    config,
  }: {
    userId: number;
    feature: AI_FEATURE;
    config: AIFeatureConfig | null;
  }): Promise<void> => {
    const [userSettings] = await getOrCreateUserSettings({ userId });

    const currentSettings: SettingsSchema = userSettings.settings ?? DEFAULT_SETTINGS;
    const currentAiSettings = currentSettings.ai ?? {};

    if (config?.connectionId && !currentAiSettings.connections?.some(({ id }) => id === config.connectionId)) {
      throw new NotFoundError({ message: t({ key: 'ai.connectionNotFound' }) });
    }

    const featureConfigs = (currentAiSettings.featureConfigs ?? []).filter(
      (candidate) => candidate.feature !== feature,
    );

    userSettings.settings = {
      ...currentSettings,
      ai: { ...currentAiSettings, featureConfigs: config ? [...featureConfigs, config] : featureConfigs },
    };

    await userSettings.save();
  },
);

/** `connectionId: null` pins the included server model, which the user has to be able to use. */
export const setFeatureConfig = async ({
  userId,
  feature,
  connectionId,
  serverKeysAllowed,
  paidPlus,
}: {
  userId: number;
  feature: AI_FEATURE;
  connectionId: string | null;
  serverKeysAllowed: boolean;
  paidPlus: boolean;
}): Promise<void> => {
  if (connectionId === null && !getServerModel({ feature, serverKeysAllowed, paidPlus })) {
    throw new ValidationError({ message: t({ key: 'ai.serverModelUnavailable' }) });
  }

  await storeFeatureConfig({ userId, feature, config: { feature, connectionId } });
};

/** The feature goes back to automatic: the default connection, else the server model. */
export const clearFeatureConfig = ({ userId, feature }: { userId: number; feature: AI_FEATURE }): Promise<void> =>
  storeFeatureConfig({ userId, feature, config: null });
