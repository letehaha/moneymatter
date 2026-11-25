import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { PeriodKey } from './portfolio-hero-derivations';

export const usePeriodLabels = () => {
  const { t } = useI18n();

  return computed<Record<PeriodKey, string>>(() => ({
    '1W': t('portfolioDetail.hero.periods.1W'),
    '1M': t('portfolioDetail.hero.periods.1M'),
    '3M': t('portfolioDetail.hero.periods.3M'),
    '6M': t('portfolioDetail.analytics.periods.6M'),
    YTD: t('portfolioDetail.hero.periods.ytd'),
    '1Y': t('portfolioDetail.hero.periods.1Y'),
    ALL: t('portfolioDetail.hero.periods.all'),
  }));
};
