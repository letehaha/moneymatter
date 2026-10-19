import { EntityLogoPayload } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

export const LOGO_SLOT_KEYS = ['logoDomain', 'logoInitials', 'logoIcon', 'logoImageId'] as const;
export const LOGO_FIELD_KEYS = [...LOGO_SLOT_KEYS, 'logoColor'] as const;

/**
 * Turns the logo keys of a write payload into the columns to write: absent key
 * stays absent, a present key is written as given. Domain, initials, icon and
 * image fill the same slot, so setting one nulls the other three. A color paints
 * behind initials or an icon only: it is rejected when neither is left after the
 * patch (falling back to `stored`, empty on create; absent key = null), and dropped when the patch
 * leaves nothing to paint behind.
 */
export const applyManualLogoPatch = ({
  patch,
  stored = {},
}: {
  patch: EntityLogoPayload;
  stored?: EntityLogoPayload;
}): EntityLogoPayload => {
  const setSlots = LOGO_SLOT_KEYS.filter((key) => patch[key] != null);
  if (setSlots.length > 1) {
    throw new ValidationError({ message: t({ key: 'brandLogos.slotsExclusive' }) });
  }

  const result: EntityLogoPayload = {};
  for (const key of LOGO_SLOT_KEYS) {
    if (patch[key] !== undefined) result[key] = patch[key];
  }

  const [setSlot] = setSlots;
  if (setSlot) {
    for (const key of LOGO_SLOT_KEYS) {
      if (key !== setSlot) result[key] = null;
    }
  }

  const effective = ({ key }: { key: (typeof LOGO_SLOT_KEYS)[number] }) =>
    result[key] !== undefined ? result[key] : (stored[key] ?? null);
  const paintable = effective({ key: 'logoInitials' }) !== null || effective({ key: 'logoIcon' }) !== null;

  if (patch.logoColor !== undefined) {
    if (patch.logoColor !== null && !paintable) {
      throw new ValidationError({ message: t({ key: 'brandLogos.colorRequiresInitials' }) });
    }
    result.logoColor = patch.logoColor;
  } else if (
    setSlot === 'logoDomain' ||
    setSlot === 'logoImageId' ||
    ((patch.logoInitials === null || patch.logoIcon === null) && !paintable)
  ) {
    result.logoColor = null;
  }

  return result;
};
