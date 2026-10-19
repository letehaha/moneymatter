/**
 * Logo Fields Serializer
 *
 * Projects the denormalized logo columns any logo-bearing entity carries onto
 * its API response.
 */
import type { EntityLogoFields } from '@bt/shared/types';
import { LOGO_FIELD_KEYS } from '@services/brand-logos/apply-manual-logo-patch';
import pick from 'lodash/pick';

export const EMPTY_LOGO_FIELDS: EntityLogoFields = {
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
};

export function serializeLogoFields({ entity }: { entity: EntityLogoFields }): EntityLogoFields {
  return pick(entity, LOGO_FIELD_KEYS);
}
