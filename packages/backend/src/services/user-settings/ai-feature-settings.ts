import { AIFeatureConfig, AI_FEATURE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { DEFAULT_SETTINGS, SettingsSchema } from '@models/user-settings.model';

import { getServerModel } from '../ai/resolution-ladder';
import { withTransaction } from '../common/with-transaction';
import { assertConnectionServesModel } from './ai-connections';
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

/**
 * `connectionId: null` pins the included server model. Only entitlement gates the pick, not the
 * AI allowance, so a pick made over the cap works again after the reset.
 *
 * `modelId` runs the feature on another model of the connection's provider. It is checked against
 * the provider before it is stored; the connection's own model is stored as no override, so the
 * feature keeps following the connection when its model changes.
 */
export const setFeatureConfig = async ({
  userId,
  feature,
  connectionId,
  modelId,
  entitledToServerKeys,
}: {
  userId: number;
  feature: AI_FEATURE;
  connectionId: string | null;
  modelId?: string;
  entitledToServerKeys: boolean;
}): Promise<void> => {
  if (connectionId === null && !getServerModel({ feature, serverKeysAllowed: entitledToServerKeys })) {
    throw new ValidationError({ message: t({ key: 'ai.serverModelUnavailable' }) });
  }

  if (modelId !== undefined && connectionId === null) {
    throw new ValidationError({ message: t({ key: 'ai.includedModelHasNoChoice' }) });
  }

  let override: string | undefined;
  if (modelId !== undefined && connectionId !== null) {
    // Asks the provider outside the settings transaction, so no lock is held across the call.
    override = (await assertConnectionServesModel({ userId, connectionId, modelId })) ?? undefined;
  }

  await storeFeatureConfig({
    userId,
    feature,
    config: { feature, connectionId, ...(override ? { modelId: override } : {}) },
  });
};

/** The feature goes back to automatic: the default connection, else the server model. */
export const clearFeatureConfig = ({ userId, feature }: { userId: number; feature: AI_FEATURE }): Promise<void> =>
  storeFeatureConfig({ userId, feature, config: null });
