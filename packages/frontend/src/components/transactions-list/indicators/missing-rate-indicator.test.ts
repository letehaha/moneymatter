import commonEn from '@/i18n/locales/chunks/en/common.json';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import MissingRateIndicator from './missing-rate-indicator.vue';

// Renders the trigger inline without the tooltip portal.
vi.mock('@/components/common/responsive-tooltip.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveTooltipStub',
      props: { content: { type: String, default: '' } },
      setup(props, { slots }) {
        return () => h('div', { 'data-tooltip': props.content }, slots.default?.());
      },
    }),
  };
});

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { ...commonEn } } });

const mountIndicator = ({ refAmountMissing }: { refAmountMissing: boolean }) =>
  mount(MissingRateIndicator, { props: { transaction: { refAmountMissing } }, global: { plugins: [i18n] } });

describe('MissingRateIndicator', () => {
  it('shows the badge with its explanation on a transaction without a base-currency amount', () => {
    const wrapper = mountIndicator({ refAmountMissing: true });

    const badge = wrapper.find('[data-testid="missing-rate-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('No rate');
    expect(wrapper.find('[data-tooltip]').attributes('data-tooltip')).toContain('left out of base-currency totals');
  });

  it('renders nothing on a transaction that has its base-currency amount', () => {
    const wrapper = mountIndicator({ refAmountMissing: false });

    expect(wrapper.find('[data-testid="missing-rate-badge"]').exists()).toBe(false);
  });
});
