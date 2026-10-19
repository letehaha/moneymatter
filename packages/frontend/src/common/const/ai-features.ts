import { AI_FEATURE } from '@bt/shared/types';
import { FileTextIcon, LineChartIcon, ListChecksIcon, ReceiptIcon, TagIcon } from '@lucide/vue';
import type { Component } from 'vue';

export type AIModelTier = 'light' | 'balanced' | 'smart';

export type AIModelNeed = 'textOnly' | 'runsOften' | 'longAnswers' | 'readsFiles' | 'structuredAnswers';

interface AIFeatureDisplayInfo {
  nameKey: string;
  descriptionKey: string;
  icon: Component;
  /** Token estimate for one unit of work, used to price 100 units. No estimate means no price. */
  tokensPerUnit?: { input: number; output: number };
  unitLabelKey?: string;
  /** How the feature calls its model, which is what decides the model it needs. */
  modelGuide: { tier: AIModelTier; needs: AIModelNeed[]; whyKey: string; picksKey: string };
  howItWorksKeys: string[];
}

/**
 * `Record<AI_FEATURE, ...>` makes a new AI_FEATURE a compile error until it's described here.
 */
const AI_FEATURE_DISPLAY_INFO: Record<AI_FEATURE, AIFeatureDisplayInfo> = {
  [AI_FEATURE.categorization]: {
    nameKey: 'common.aiFeatures.categorization.name',
    descriptionKey: 'common.aiFeatures.categorization.description',
    icon: TagIcon,
    // Description + category list in, a category name out
    tokensPerUnit: { input: 250, output: 30 },
    unitLabelKey: 'settings.ai.modelSelector.modelInfo.per100Transactions',
    modelGuide: {
      tier: 'light',
      needs: ['textOnly', 'runsOften'],
      whyKey: 'settings.ai.modelGuide.why.categorization',
      picksKey: 'settings.ai.modelGuide.picks.categorization',
    },
    howItWorksKeys: [
      'settings.ai.categorization.howItWorks.points.autoSync',
      'settings.ai.categorization.howItWorks.points.analysis',
      'settings.ai.categorization.howItWorks.points.override',
    ],
  },
  [AI_FEATURE.statementParsing]: {
    nameKey: 'common.aiFeatures.statementParsing.name',
    descriptionKey: 'common.aiFeatures.statementParsing.description',
    icon: FileTextIcon,
    tokensPerUnit: { input: 500, output: 50 },
    unitLabelKey: 'settings.ai.modelSelector.modelInfo.per100Transactions',
    modelGuide: {
      tier: 'balanced',
      needs: ['textOnly', 'longAnswers'],
      whyKey: 'settings.ai.modelGuide.why.statementParsing',
      picksKey: 'settings.ai.modelGuide.picks.statementParsing',
    },
    howItWorksKeys: [
      'settings.ai.statementParsing.howItWorks.points.upload',
      'settings.ai.statementParsing.howItWorks.points.analysis',
      'settings.ai.statementParsing.howItWorks.points.review',
      'settings.ai.statementParsing.howItWorks.points.cost',
    ],
  },
  [AI_FEATURE.investmentTransactionsParsing]: {
    nameKey: 'common.aiFeatures.investmentTransactionsParsing.name',
    descriptionKey: 'common.aiFeatures.investmentTransactionsParsing.description',
    icon: LineChartIcon,
    tokensPerUnit: { input: 500, output: 50 },
    unitLabelKey: 'settings.ai.modelSelector.modelInfo.per100Transactions',
    modelGuide: {
      tier: 'balanced',
      needs: ['textOnly', 'longAnswers'],
      whyKey: 'settings.ai.modelGuide.why.investmentTransactionsParsing',
      picksKey: 'settings.ai.modelGuide.picks.investmentTransactionsParsing',
    },
    howItWorksKeys: [],
  },
  [AI_FEATURE.receiptParsing]: {
    nameKey: 'common.aiFeatures.receiptParsing.name',
    descriptionKey: 'common.aiFeatures.receiptParsing.description',
    icon: ReceiptIcon,
    // The invoice file itself goes to the model, with a JSON schema for the answer
    modelGuide: {
      tier: 'balanced',
      needs: ['readsFiles', 'structuredAnswers'],
      whyKey: 'settings.ai.modelGuide.why.receiptParsing',
      picksKey: 'settings.ai.modelGuide.picks.receiptParsing',
    },
    howItWorksKeys: [],
  },
  [AI_FEATURE.trackerMatching]: {
    nameKey: 'common.aiFeatures.trackerMatching.name',
    descriptionKey: 'common.aiFeatures.trackerMatching.description',
    icon: ListChecksIcon,
    // Tracker description and examples plus a pipe table in, a few scored matches out
    tokensPerUnit: { input: 60, output: 10 },
    unitLabelKey: 'settings.ai.modelSelector.modelInfo.per100Transactions',
    modelGuide: {
      tier: 'light',
      needs: ['textOnly', 'runsOften', 'structuredAnswers'],
      whyKey: 'settings.ai.modelGuide.why.trackerMatching',
      picksKey: 'settings.ai.modelGuide.picks.trackerMatching',
    },
    howItWorksKeys: [],
  },
};

export function getAIFeatureDisplayInfo({ feature }: { feature: AI_FEATURE }): AIFeatureDisplayInfo {
  return AI_FEATURE_DISPLAY_INFO[feature];
}
