import BrandLogo from '@/components/common/brand-logo.vue';
import PortfolioLogo from '@/components/common/portfolio-logo.vue';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const buildPortfolio = (overrides = {}) => ({
  name: 'Broker',
  portfolioType: PORTFOLIO_TYPE.retirement,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

describe('PortfolioLogo', () => {
  it('renders the logo when the portfolio has one', () => {
    const wrapper = mount(PortfolioLogo, { props: { portfolio: buildPortfolio({ logoDomain: 'vanguard.com' }) } });

    expect(wrapper.findComponent(BrandLogo).props('domain')).toBe('vanguard.com');
  });

  it('falls back to the portfolio type chip', () => {
    const wrapper = mount(PortfolioLogo, { props: { portfolio: buildPortfolio() } });

    expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
    expect(wrapper.classes()).toContain('text-account-saving');
    expect(wrapper.find('svg').exists()).toBe(true);
  });
});
