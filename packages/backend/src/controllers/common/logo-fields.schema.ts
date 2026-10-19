import { type EntityLogoWritePayload, LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { LOGO_SLOT_KEYS } from '@services/brand-logos/apply-manual-logo-patch';
import { DATA_URL_PATTERN } from '@services/logo-images/logo-images.service';
import { z } from 'zod';

import { logoDomainSchema } from './logo-domain.schema';
import { logoColorSchema, logoInitialsSchema } from './logo-initials.schema';

/**
 * The logo keys of a write body, ready to spread into a `z.object`. Absent key =
 * leave the stored column untouched, explicit null = clear it.
 */
export const logoFieldsShape = {
  logoDomain: logoDomainSchema.optional(),
  logoInitials: logoInitialsSchema.optional(),
  logoColor: logoColorSchema.optional(),
  logoIcon: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .nullable()
    .optional(),
};

/** An uploaded logo as a base64 data URL; null clears the stored image. */
export const logoImageSchema = z
  .string()
  .max(Math.ceil(LOGO_IMAGE_MAX_BYTES / 3) * 4 + 64)
  .regex(DATA_URL_PATTERN)
  .nullable()
  .optional();

const SLOT_KEYS = LOGO_SLOT_KEYS.map((key) => (key === 'logoImageId' ? ('logoImage' as const) : key));

/**
 * Body-level `.superRefine` for any payload carrying `logoFieldsShape`: domain,
 * initials, icon and image are ways to fill the same slot, so a payload asking
 * for more than one is rejected instead of silently letting one win.
 */
export const refineLogoFields = ({ data, ctx }: { data: EntityLogoWritePayload; ctx: z.RefinementCtx }): void => {
  const setKeys = SLOT_KEYS.filter((key) => data[key] != null);
  if (setKeys.length > 1) {
    ctx.addIssue({
      code: 'custom',
      message: t({ key: 'brandLogos.slotsExclusive' }),
      path: [setKeys[1]!],
    });
  }
};

/**
 * `refineLogoFields` plus the create-only rule: a color paints the background of
 * a monogram or an icon, and a create has nothing stored to apply it to. Update
 * bodies are patches where a color alone recolors the stored monogram or icon,
 * so they keep using `refineLogoFields`.
 */
export const refineLogoFieldsOnCreate = ({
  data,
  ctx,
}: {
  data: EntityLogoWritePayload;
  ctx: z.RefinementCtx;
}): void => {
  refineLogoFields({ data, ctx });

  if (data.logoColor != null && data.logoInitials == null && data.logoIcon == null) {
    ctx.addIssue({
      code: 'custom',
      message: t({ key: 'brandLogos.colorRequiresInitials' }),
      path: ['logoColor'],
    });
  }
};
