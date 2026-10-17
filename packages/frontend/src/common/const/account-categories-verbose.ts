import { ACCOUNT_CATEGORIES } from '@bt/shared/types';

/**
 * Maps account category enum values to their translation keys.
 * Use with t() from vue-i18n: t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[category])
 */
export const ACCOUNT_CATEGORIES_TRANSLATION_KEYS = Object.freeze<Record<ACCOUNT_CATEGORIES, string>>({
  [ACCOUNT_CATEGORIES.general]: 'common.accountCategories.general',
  [ACCOUNT_CATEGORIES.cash]: 'common.accountCategories.cash',
  [ACCOUNT_CATEGORIES.currentAccount]: 'common.accountCategories.currentAccount',
  [ACCOUNT_CATEGORIES.creditCard]: 'common.accountCategories.creditCard',
  [ACCOUNT_CATEGORIES.saving]: 'common.accountCategories.saving',
  [ACCOUNT_CATEGORIES.bonus]: 'common.accountCategories.bonus',
  [ACCOUNT_CATEGORIES.insurance]: 'common.accountCategories.insurance',
  [ACCOUNT_CATEGORIES.investment]: 'common.accountCategories.investment',
  [ACCOUNT_CATEGORIES.loan]: 'common.accountCategories.loan',
  [ACCOUNT_CATEGORIES.overdraft]: 'common.accountCategories.overdraft',
  [ACCOUNT_CATEGORIES.crypto]: 'common.accountCategories.crypto',
  [ACCOUNT_CATEGORIES.vehicle]: 'common.accountCategories.vehicle',
  [ACCOUNT_CATEGORIES.property]: 'common.accountCategories.property',
});
