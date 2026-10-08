import type { Component } from 'vue';

export interface WidgetSize {
  colSpan: number;
  rowSpan: number;
  label: string;
}

export interface WidgetConfigOption {
  key: string;
  label: string;
  defaultValue?: string;
  choices: { value: string; label: string }[];
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  defaultColSpan: number;
  defaultRowSpan: number;
  allowedSizes: WidgetSize[];
  component: () => Promise<{ default: Component }>;
  needsPeriod: boolean;
  configOptions?: WidgetConfigOption[];
}

export const FIRE_WIDGET_ID = 'fire-progress';

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'balance-trend': {
    id: 'balance-trend',
    name: 'dashboard.widgets.registry.balanceTrend.name',
    description: 'dashboard.widgets.registry.balanceTrend.description',
    defaultColSpan: 2,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
      { colSpan: 3, rowSpan: 1, label: '3×1' },
    ],
    component: () => import('@/components/widgets/balance-trend.vue'),
    needsPeriod: true,
  },
  'spending-categories': {
    id: 'spending-categories',
    name: 'dashboard.widgets.registry.spendingCategories.name',
    description: 'dashboard.widgets.registry.spendingCategories.description',
    defaultColSpan: 2,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/expenses-structure/index.vue'),
    needsPeriod: true,
  },
  'latest-records': {
    id: 'latest-records',
    name: 'dashboard.widgets.registry.latestRecords.name',
    description: 'dashboard.widgets.registry.latestRecords.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 1, rowSpan: 2, label: '1×2' },
    ],
    component: () => import('@/components/widgets/latest-records.vue'),
    needsPeriod: false,
    configOptions: [
      {
        key: 'includeScheduled',
        label: 'widgets.latestRecords.config.includeScheduled.label',
        defaultValue: 'true',
        choices: [
          { value: 'true', label: 'widgets.latestRecords.config.includeScheduled.on' },
          { value: 'false', label: 'widgets.latestRecords.config.includeScheduled.off' },
        ],
      },
    ],
  },
  'category-spending-tracker': {
    id: 'category-spending-tracker',
    name: 'dashboard.widgets.registry.categoryTracker.name',
    description: 'dashboard.widgets.registry.categoryTracker.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1\u00d71' },
      { colSpan: 1, rowSpan: 2, label: '1\u00d72' },
    ],
    component: () => import('@/components/widgets/category-spending-tracker/index.vue'),
    needsPeriod: true,
  },
  'cash-flow': {
    id: 'cash-flow',
    name: 'dashboard.widgets.registry.cashFlow.name',
    description: 'dashboard.widgets.registry.cashFlow.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/cash-flow-widget/index.vue'),
    needsPeriod: true,
  },
  taxes: {
    id: 'taxes',
    name: 'dashboard.widgets.registry.taxes.name',
    description: 'dashboard.widgets.registry.taxes.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [{ colSpan: 1, rowSpan: 1, label: '1×1' }],
    component: () => import('@/components/widgets/taxes-widget/index.vue'),
    needsPeriod: false,
    configOptions: [
      {
        key: 'months',
        label: 'dashboard.widgets.taxes.config.months.label',
        defaultValue: '12',
        choices: [
          { value: '3', label: 'dashboard.widgets.taxes.config.months.m3' },
          { value: '6', label: 'dashboard.widgets.taxes.config.months.m6' },
          { value: '12', label: 'dashboard.widgets.taxes.config.months.m12' },
        ],
      },
    ],
  },
  'net-worth': {
    id: 'net-worth',
    name: 'dashboard.widgets.registry.netWorth.name',
    description: 'dashboard.widgets.registry.netWorth.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/net-worth-widget/index.vue'),
    needsPeriod: true,
  },
  'credit-utilization': {
    id: 'credit-utilization',
    name: 'dashboard.widgets.registry.creditUtilization.name',
    description: 'dashboard.widgets.registry.creditUtilization.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 1, rowSpan: 2, label: '1×2' },
    ],
    component: () => import('@/components/widgets/credit-utilization-widget.vue'),
    needsPeriod: false,
  },
  'planned-overview': {
    id: 'planned-overview',
    name: 'dashboard.widgets.registry.plannedOverview.name',
    description: 'dashboard.widgets.registry.plannedOverview.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/planned-overview.vue'),
    needsPeriod: false,
  },
  'subscriptions-overview': {
    id: 'subscriptions-overview',
    name: 'dashboard.widgets.registry.subscriptions.name',
    description: 'dashboard.widgets.registry.subscriptions.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/subscriptions-overview.vue'),
    needsPeriod: false,
  },
  [FIRE_WIDGET_ID]: {
    id: FIRE_WIDGET_ID,
    name: 'dashboard.widgets.registry.fireProgress.name',
    description: 'dashboard.widgets.registry.fireProgress.description',
    defaultColSpan: 1,
    defaultRowSpan: 1,
    allowedSizes: [
      { colSpan: 1, rowSpan: 1, label: '1×1' },
      { colSpan: 2, rowSpan: 1, label: '2×1' },
    ],
    component: () => import('@/components/widgets/fire-progress-widget/index.vue'),
    needsPeriod: false,
    configOptions: [
      {
        key: 'style',
        label: 'widgets.fireProgress.config.style.label',
        defaultValue: 'ring',
        choices: [
          { value: 'ring', label: 'widgets.fireProgress.config.style.ring' },
          { value: 'numbers', label: 'widgets.fireProgress.config.style.numbers' },
        ],
      },
    ],
  },
};

export const DEFAULT_DASHBOARD_LAYOUT = [
  { widgetId: 'balance-trend', colSpan: 2 },
  { widgetId: 'latest-records', colSpan: 1, rowSpan: 2 },
  { widgetId: 'subscriptions-overview', colSpan: 1 },
  { widgetId: 'spending-categories', colSpan: 1 },
];
