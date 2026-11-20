import BrandLogo from '@/components/common/brand-logo.vue';
import VentureDealLogo from '@/components/common/venture-deal-logo.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const buildDeal = (overrides = {}) => ({
  name: 'Stripe SPV',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

describe('VentureDealLogo', () => {
  it('renders the logo when the deal has one', () => {
    const wrapper = mount(VentureDealLogo, { props: { deal: buildDeal({ logoDomain: 'stripe.com' }) } });

    expect(wrapper.findComponent(BrandLogo).props('domain')).toBe('stripe.com');
  });

  it('falls back to the rocket chip', () => {
    const wrapper = mount(VentureDealLogo, { props: { deal: buildDeal() } });

    expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
    expect(wrapper.find('svg').exists()).toBe(true);
  });
});
