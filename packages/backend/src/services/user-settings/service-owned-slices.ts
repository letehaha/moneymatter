import { type SettingsSchema } from '@models/user-settings.model';
import mergeWith from 'lodash/mergeWith';
import omit from 'lodash/omit';

/**
 * Settings paths writable only through their own endpoints, which enforce invariants a
 * wholesale write cannot, such as the outbound URL guard and key encryption on AI connections,
 * or a feature pick naming a connection that exists. `PUT /user/settings` and
 * `PATCH /user/settings` drop these paths from the request.
 *
 * `ai.chat` is written by `PUT /chat/settings`, which recomputes every thread's expiry in the same
 * transaction; a stale cached settings object sent back whole must never write an old retention
 * without that recompute.
 */
const SERVICE_OWNED_SETTING_PATHS = ['onboarding', 'ai.connections', 'ai.featureConfigs', 'ai.chat'] as const;

export const stripServiceOwnedSlices = <T extends object>({ settings }: { settings: T }): T =>
  omit(settings, [...SERVICE_OWNED_SETTING_PATHS]) as unknown as T;

/**
 * Deep-merges into the stored settings: an absent key never erases one, and the customizer
 * replaces arrays wholesale so an incoming array is the full list. A shallow spread would be
 * wrong here, because a request carrying a partial `ai` object would drop the stored connections
 * alongside it.
 */
export const mergeIntoStoredSettings = ({
  stored,
  incoming,
}: {
  stored: SettingsSchema;
  incoming: object;
}): SettingsSchema =>
  mergeWith({}, stored, incoming, (_current, next) => (Array.isArray(next) ? next : undefined)) as SettingsSchema;
