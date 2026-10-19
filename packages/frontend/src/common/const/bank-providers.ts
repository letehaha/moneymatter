import { BANK_PROVIDER_TYPE } from '@bt/shared/types';

export type PricingType = 'free' | 'paid';
export type DifficultyType = 'easy' | 'medium' | 'very-difficult';

export interface ProviderRegion {
  code: 'ua' | 'eu' | 'gb' | 'us' | 'pl' | 'ca' | 'au' | 'nz';
  labelKey: string;
}

interface ProviderMetainfo {
  nameKey: string;
  descriptionKey: string;
  pricingLabelKey: string;
  difficultyLabelKey: string;
  difficultyTooltipKey: string;
  pricing: PricingType;
  difficulty: DifficultyType;
  regions: ProviderRegion[];
}

const REGIONS = {
  ukraine: { code: 'ua', labelKey: 'pages.integrations.regions.ukraine' },
  eu: { code: 'eu', labelKey: 'pages.integrations.regions.eu' },
  uk: { code: 'gb', labelKey: 'pages.integrations.regions.uk' },
  usa: { code: 'us', labelKey: 'pages.integrations.regions.usa' },
  poland: { code: 'pl', labelKey: 'pages.integrations.regions.poland' },
  canada: { code: 'ca', labelKey: 'pages.integrations.regions.canada' },
  australia: { code: 'au', labelKey: 'pages.integrations.regions.australia' },
  newZealand: { code: 'nz', labelKey: 'pages.integrations.regions.newZealand' },
} as const satisfies Record<string, ProviderRegion>;

// Translation keys for bank provider metadata
// Use t() with these keys in components to get translated strings
export const METAINFO_FROM_TYPE: Record<string, ProviderMetainfo> = {
  [BANK_PROVIDER_TYPE.MONOBANK]: {
    nameKey: 'pages.integrations.providers.monobank.name',
    descriptionKey: 'pages.integrations.providers.monobank.description',
    pricingLabelKey: 'pages.integrations.labels.free',
    difficultyLabelKey: 'pages.integrations.labels.easySetup',
    difficultyTooltipKey: 'pages.integrations.tooltips.monobank',
    pricing: 'free',
    difficulty: 'easy',
    regions: [REGIONS.ukraine],
  },
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: {
    nameKey: 'pages.integrations.providers.enableBanking.name',
    descriptionKey: 'pages.integrations.providers.enableBanking.description',
    pricingLabelKey: 'pages.integrations.labels.free',
    difficultyLabelKey: 'pages.integrations.labels.veryDifficultSetup',
    difficultyTooltipKey: 'pages.integrations.tooltips.enableBanking',
    pricing: 'free',
    difficulty: 'very-difficult',
    regions: [REGIONS.eu, REGIONS.uk],
  },
  [BANK_PROVIDER_TYPE.LUNCHFLOW]: {
    nameKey: 'pages.integrations.providers.lunchflow.name',
    descriptionKey: 'pages.integrations.providers.lunchflow.description',
    pricingLabelKey: 'pages.integrations.labels.paid',
    difficultyLabelKey: 'pages.integrations.labels.easySetup',
    difficultyTooltipKey: 'pages.integrations.tooltips.lunchflow',
    pricing: 'paid',
    difficulty: 'easy',
    regions: [REGIONS.usa, REGIONS.eu, REGIONS.uk, REGIONS.canada, REGIONS.australia, REGIONS.newZealand],
  },
  [BANK_PROVIDER_TYPE.WALUTOMAT]: {
    nameKey: 'pages.integrations.providers.walutomat.name',
    descriptionKey: 'pages.integrations.providers.walutomat.description',
    pricingLabelKey: 'pages.integrations.labels.free',
    difficultyLabelKey: 'pages.integrations.labels.mediumSetup',
    difficultyTooltipKey: 'pages.integrations.tooltips.walutomat',
    pricing: 'free',
    difficulty: 'medium',
    regions: [REGIONS.poland],
  },
  [BANK_PROVIDER_TYPE.SIMPLEFIN]: {
    nameKey: 'pages.integrations.providers.simplefin.name',
    descriptionKey: 'pages.integrations.providers.simplefin.description',
    pricingLabelKey: 'pages.integrations.labels.paid',
    difficultyLabelKey: 'pages.integrations.labels.easySetup',
    difficultyTooltipKey: 'pages.integrations.tooltips.simplefin',
    pricing: 'paid',
    difficulty: 'easy',
    regions: [REGIONS.usa, REGIONS.canada],
  },
};

interface RegionFilterGroup {
  key: string;
  labelKey: string;
  flagCode: string;
  codes: readonly ProviderRegion['code'][];
}

export const REGION_FILTER_ALL = 'all';

export const REGION_FILTER_GROUPS: readonly RegionFilterGroup[] = [
  { key: 'usCanada', labelKey: 'pages.integrations.filters.usCanada', flagCode: 'us', codes: ['us', 'ca'] },
  { key: 'euUk', labelKey: 'pages.integrations.filters.euUk', flagCode: 'eu', codes: ['eu', 'gb'] },
  { key: 'ukraine', labelKey: 'pages.integrations.regions.ukraine', flagCode: 'ua', codes: ['ua'] },
  // Poland also matches 'eu': EU-wide providers (PSD2) cover Polish banks.
  { key: 'poland', labelKey: 'pages.integrations.regions.poland', flagCode: 'pl', codes: ['pl', 'eu'] },
];

export const providerMatchesRegionFilter = ({
  regions,
  codes,
}: {
  regions: readonly ProviderRegion[];
  codes: readonly ProviderRegion['code'][];
}): boolean => regions.some((region) => codes.includes(region.code));

export const PROVIDER_DISPLAY_ORDER: readonly string[] = [
  BANK_PROVIDER_TYPE.LUNCHFLOW,
  BANK_PROVIDER_TYPE.SIMPLEFIN,
  BANK_PROVIDER_TYPE.MONOBANK,
  BANK_PROVIDER_TYPE.ENABLE_BANKING,
  BANK_PROVIDER_TYPE.WALUTOMAT,
];
