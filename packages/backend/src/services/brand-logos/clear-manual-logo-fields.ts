import type { EntityLogoFields, LogoResolutionState } from '@bt/shared/types';

/** The logo columns every logo-carrying entity row declares. */
type LogoColumns = EntityLogoFields & { logoSource: LogoResolutionState };

const CLEARED_LOGO_COLUMNS: { [Key in keyof LogoColumns]: null } = {
  logoDomain: null,
  logoSource: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
};

/**
 * Wipes the logo columns on the instance in memory – the caller persists it.
 * `logoSource: null` is what marks the row as needing a resolution pass again,
 * so entities with auto-resolution must also enqueue one after the commit.
 */
export const clearManualLogoFields = ({ instance }: { instance: LogoColumns }): void => {
  Object.assign(instance, CLEARED_LOGO_COLUMNS);
};
