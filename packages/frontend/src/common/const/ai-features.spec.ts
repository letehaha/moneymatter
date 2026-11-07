import { type AIFeatureStatus, AI_FEATURE } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { type ConfigurableAIFeature, getAIFeatureDisplayInfo, pickConfigurableFeatureStatuses } from './ai-features';

const configurableFeatures = Object.values(AI_FEATURE).filter(
  (feature): feature is ConfigurableAIFeature => feature !== AI_FEATURE.chat,
);

describe('getAIFeatureDisplayInfo', () => {
  it.each(configurableFeatures)('describes %s', (feature) => {
    const info = getAIFeatureDisplayInfo({ feature });

    expect(info.nameKey).toMatch(/^common\.aiFeatures\./);
    expect(info.modelGuide.needs.length).toBeGreaterThan(0);
  });
});

describe('pickConfigurableFeatureStatuses', () => {
  const status = ({ feature }: { feature: AI_FEATURE }) => ({ feature }) as AIFeatureStatus;

  it('leaves chat out: its model is picked in the conversation, not in Settings', () => {
    const statuses = Object.values(AI_FEATURE).map((feature) => status({ feature }));

    const picked = pickConfigurableFeatureStatuses({ statuses });

    expect(picked.map(({ feature }) => feature)).toEqual(configurableFeatures);
  });
});
