import { PUSH_GROUP_DEFAULTS, type PushGroup } from '@bt/shared/types';
import type { SettingsSchema } from '@models/user-settings.model';

/**
 * Whether the user wants push notifications of `group`. An unset group takes its default, and
 * missing settings count as unset. `notifications.enabled` and `notifications.types` are not
 * consulted: nothing sets them.
 */
export const isPushGroupEnabled = ({
  settings,
  group,
}: {
  settings: Partial<SettingsSchema> | null | undefined;
  group: PushGroup;
}): boolean => settings?.notifications?.push?.groups?.[group] ?? PUSH_GROUP_DEFAULTS[group];
