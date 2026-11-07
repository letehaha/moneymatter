import type { McpToolset } from '@bt/shared/types';

// i18n keys in the always-loaded `common` messages, so both the consent screen and
// the connected apps page can name a toolset.
export const MCP_TOOLSET_LABELS: Record<McpToolset, { labelKey: string; descriptionKey: string }> = {
  core: { labelKey: 'mcpToolsets.core.label', descriptionKey: 'mcpToolsets.core.description' },
  subscriptions: {
    labelKey: 'mcpToolsets.subscriptions.label',
    descriptionKey: 'mcpToolsets.subscriptions.description',
  },
  'budget-plans': {
    labelKey: 'mcpToolsets.budgetPlans.label',
    descriptionKey: 'mcpToolsets.budgetPlans.description',
  },
  trackers: { labelKey: 'mcpToolsets.trackers.label', descriptionKey: 'mcpToolsets.trackers.description' },
  automations: {
    labelKey: 'mcpToolsets.automations.label',
    descriptionKey: 'mcpToolsets.automations.description',
  },
  review: { labelKey: 'mcpToolsets.review.label', descriptionKey: 'mcpToolsets.review.description' },
  'groups-templates': {
    labelKey: 'mcpToolsets.groupsTemplates.label',
    descriptionKey: 'mcpToolsets.groupsTemplates.description',
  },
  investments: {
    labelKey: 'mcpToolsets.investments.label',
    descriptionKey: 'mcpToolsets.investments.description',
  },
  ventures: { labelKey: 'mcpToolsets.ventures.label', descriptionKey: 'mcpToolsets.ventures.description' },
  'loans-vehicles': {
    labelKey: 'mcpToolsets.loansVehicles.label',
    descriptionKey: 'mcpToolsets.loansVehicles.description',
  },
  currencies: { labelKey: 'mcpToolsets.currencies.label', descriptionKey: 'mcpToolsets.currencies.description' },
  imports: { labelKey: 'mcpToolsets.imports.label', descriptionKey: 'mcpToolsets.imports.description' },
};
