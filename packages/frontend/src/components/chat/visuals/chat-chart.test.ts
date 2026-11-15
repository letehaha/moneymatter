import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import type { ChatChartSpec, ChatDonutChartSpec, ChatSeriesChartSpec } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ChatChart from './chat-chart.vue';

const mountChart = ({ spec }: { spec: ChatChartSpec }) =>
  mount(ChatChart, {
    props: { spec },
    global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: enChat } })] },
  });

const seriesSpec = (overrides: Partial<ChatSeriesChartSpec> = {}): ChatSeriesChartSpec => ({
  type: 'chart',
  kind: 'line',
  title: 'Spending by month',
  unit: { kind: 'money', currencyCode: 'USD' },
  xAxis: { type: 'date', values: ['2026-01-01', '2026-02-01', '2026-03-01'] },
  series: [
    { name: 'Food', values: [100, 200, 150] },
    { name: 'Rent', values: [900, 900, 950] },
  ],
  ...overrides,
});

const donutSpec = ({ count }: { count: number }): ChatDonutChartSpec => ({
  type: 'chart',
  kind: 'donut',
  title: 'Share by category',
  unit: { kind: 'money', currencyCode: 'USD' },
  slices: Array.from({ length: count }, (_, index) => ({ label: `Cat ${index + 1}`, value: (count - index) * 10 })),
});

describe('ChatChart', () => {
  it('shows the title', () => {
    expect(mountChart({ spec: seriesSpec() }).text()).toContain('Spending by month');
  });

  it('draws one line path per series', () => {
    const wrapper = mountChart({ spec: seriesSpec() });

    expect(wrapper.findAll('[data-testid="chart-line"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="chart-bars"]')).toHaveLength(0);
  });

  it('draws an area fill next to each line of an area chart', () => {
    const wrapper = mountChart({ spec: seriesSpec({ kind: 'area' }) });

    expect(wrapper.findAll('[data-testid="chart-line"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-testid="chart-area"]')).toHaveLength(2);
  });

  it('draws one bar group per series for bar and stacked bar charts', () => {
    for (const kind of ['bar', 'stackedBar'] as const) {
      const wrapper = mountChart({ spec: seriesSpec({ kind }) });

      expect(wrapper.findAll('[data-testid="chart-bars"]')).toHaveLength(2);
      expect(wrapper.findAll('[data-testid="chart-bars"]')[0]!.findAll('rect')).toHaveLength(3);
      expect(wrapper.findAll('[data-testid="chart-line"]')).toHaveLength(0);
    }
  });

  it('leaves a gap for a null value', () => {
    const wrapper = mountChart({
      spec: seriesSpec({ series: [{ name: 'Food', values: [100, null, 150] }] }),
    });
    const path = wrapper.find('[data-testid="chart-line"]').attributes('d')!;

    expect(path.match(/M/g)).toHaveLength(2);
  });

  it('labels the series in a legend', () => {
    const wrapper = mountChart({ spec: seriesSpec() });

    expect(wrapper.find('[data-testid="chart-legend"]').text()).toContain('Food');
    expect(wrapper.find('[data-testid="chart-legend"]').text()).toContain('Rent');
  });

  it('formats the value axis in the chart currency', () => {
    const wrapper = mountChart({ spec: seriesSpec() });

    expect(wrapper.find('svg').text()).toMatch(/\$\d/);
  });

  it('shows the values of every series in a tooltip on hover', async () => {
    const wrapper = mountChart({ spec: seriesSpec() });

    await wrapper.findAll('[data-testid="chart-hover-slot"]')[1]!.trigger('pointermove');

    const tooltip = wrapper.find('[data-testid="chart-tooltip"]');
    expect(tooltip.isVisible()).toBe(true);
    expect(tooltip.text()).toContain('Food');
    expect(tooltip.text()).toContain('$200.00');
    expect(tooltip.text()).toContain('$900.00');
  });

  it('draws one arc per donut slice and shows each slice with its value and share', () => {
    const wrapper = mountChart({ spec: donutSpec({ count: 3 }) });

    expect(wrapper.findAll('[data-testid="chart-slice"]')).toHaveLength(3);
    const legend = wrapper.find('[data-testid="chart-legend"]').text();
    expect(legend).toContain('Cat 1');
    expect(legend).toContain('$30.00');
    expect(legend).toContain('50%');
  });

  it('folds donut slices past twelve into Others', () => {
    const wrapper = mountChart({ spec: donutSpec({ count: 15 }) });

    expect(wrapper.findAll('[data-testid="chart-slice"]')).toHaveLength(13);
    const legend = wrapper.find('[data-testid="chart-legend"]').text();
    expect(legend).toContain('Others');
    expect(legend).not.toContain('Cat 13');
  });

  it('shows an empty state instead of an empty plot', () => {
    for (const spec of [
      seriesSpec({ series: [{ name: 'Food', values: [null, null, null] }] }),
      seriesSpec({ xAxis: { type: 'date', values: [] }, series: [{ name: 'Food', values: [] }] }),
      { ...donutSpec({ count: 0 }) },
      { ...donutSpec({ count: 2 }), slices: [{ label: 'A', value: 0 }] },
    ]) {
      const wrapper = mountChart({ spec });

      expect(wrapper.find('[data-testid="chart-empty"]').text()).toBe('Nothing to chart yet.');
      expect(wrapper.find('svg').exists()).toBe(false);
    }
  });

  it('never renders model text as markup', () => {
    const wrapper = mountChart({
      spec: seriesSpec({ title: '<img src=x onerror=alert(1)>', series: [{ name: '<b>x</b>', values: [1, 2, 3] }] }),
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('b').exists()).toBe(false);
  });
});
