import { PROPERTY_TYPE } from '@bt/shared/types';

/**
 * Maps property-type enum values to their translation keys. Same shape as
 * ACCOUNT_CATEGORIES_TRANSLATION_KEYS — use with i18n t().
 */
export const PROPERTY_TYPE_TRANSLATION_KEYS = Object.freeze({
  [PROPERTY_TYPE.house]: 'common.propertyTypes.house',
  [PROPERTY_TYPE.apartment]: 'common.propertyTypes.apartment',
  [PROPERTY_TYPE.condo]: 'common.propertyTypes.condo',
  [PROPERTY_TYPE.townhouse]: 'common.propertyTypes.townhouse',
  [PROPERTY_TYPE.land]: 'common.propertyTypes.land',
  [PROPERTY_TYPE.commercial]: 'common.propertyTypes.commercial',
  [PROPERTY_TYPE.industrial]: 'common.propertyTypes.industrial',
  [PROPERTY_TYPE.vacation]: 'common.propertyTypes.vacation',
  [PROPERTY_TYPE.other]: 'common.propertyTypes.other',
});
