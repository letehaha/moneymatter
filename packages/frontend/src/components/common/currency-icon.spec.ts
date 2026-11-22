import BrandLogo from '@/components/common/brand-logo.vue';
import CurrencyIcon from '@/components/common/currency-icon.vue';
import { registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useCurrenciesStore } from '@/stores/currencies';
import type { EntityLogoPayload, UserCurrencyModel } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

const IMAGE_ID = '00000000-0000-4000-8000-000000000001';

const buildHolding = ({ code, logo = {} }: { code: string; logo?: EntityLogoPayload }) =>
  ({
    currencyCode: code,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    ...logo,
  }) as UserCurrencyModel;

const mountIcon = ({
  code,
  holdings = [],
  props = {},
}: {
  code: string;
  holdings?: UserCurrencyModel[];
  props?: Record<string, unknown>;
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  useCurrenciesStore().currencies = holdings;

  return mount(CurrencyIcon, { props: { code, ...props }, global: { plugins: [pinia] } });
};

describe('CurrencyIcon', () => {
  beforeEach(() => {
    resetCurrencyDecimals();
    registerCurrencyDecimals({
      entries: [
        { code: 'BTC', decimals: 8, isCustom: true, symbol: '₿' },
        { code: 'USDT', decimals: 6, isCustom: true, symbol: null },
      ],
    });
  });

  it('shows the flag of an ISO currency', () => {
    const wrapper = mountIcon({ code: 'USD' });

    const image = wrapper.find('img');
    expect(image.attributes('src')).toBe('https://wise.com/web-art/assets/flags/usd.svg');
    expect(image.attributes('alt')).toBe('USD');
    expect(wrapper.find('[data-testid="currency-icon-monogram"]').exists()).toBe(false);
  });

  it('falls back to the code monogram when the flag fails to load', async () => {
    const wrapper = mountIcon({ code: 'USD' });

    await wrapper.find('img').trigger('error');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('US');
  });

  it('draws the uploaded image of a custom currency through BrandLogo', () => {
    const wrapper = mountIcon({
      code: 'BTC',
      holdings: [buildHolding({ code: 'BTC', logo: { logoImageId: IMAGE_ID } })],
    });

    expect(wrapper.getComponent(BrandLogo).props()).toMatchObject({ imageId: IMAGE_ID, name: '₿' });
    expect(wrapper.find('[data-testid="currency-icon-monogram"]').exists()).toBe(false);
  });

  it('draws the letters and color the user picked for a custom currency', () => {
    const wrapper = mountIcon({
      code: 'BTC',
      holdings: [buildHolding({ code: 'BTC', logo: { logoInitials: 'B', logoColor: '#f7931a' } })],
    });

    expect(wrapper.getComponent(BrandLogo).props()).toMatchObject({ initials: 'B', color: '#f7931a' });
    expect(wrapper.get('[data-testid="currency-icon-logo"]').attributes()).toMatchObject({
      role: 'img',
      'aria-label': 'BTC',
    });
  });

  it('draws the symbol of a custom currency without a logo as its monogram', () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC' })] });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('₿');
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('BTC');
  });

  it('draws the code of a custom currency without a symbol or a logo', () => {
    const wrapper = mountIcon({ code: 'USDT', holdings: [buildHolding({ code: 'USDT' })] });

    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('US');
  });

  it('shows the monogram, not the flag, for a custom code the user does not hold', () => {
    const wrapper = mountIcon({ code: 'USDT' });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('US');
  });

  it.each([
    ['size-3.5', 'U', 'text-xs'],
    ['size-5', 'US', 'text-xs'],
    ['size-8', 'USD', 'text-sm'],
  ])('fits the monogram at %s to the characters it has room for, never under 12px', (size, text, fontClass) => {
    const wrapper = mountIcon({ code: 'USDT', props: { size } });
    const monogram = wrapper.get('[data-testid="currency-icon-monogram"]');

    expect(monogram.text()).toBe(text);
    expect(monogram.classes()).toContain(fontClass);
  });

  it("uses the owner's definition passed as meta for a custom code outside the registry", () => {
    const wrapper = mountIcon({
      code: 'SAT',
      props: { meta: { decimals: 8, symbol: 's', isCustom: true } },
    });

    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('s');
  });

  it('follows a logo change in the currency list', async () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC' })] });
    expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);

    useCurrenciesStore().currencies = [buildHolding({ code: 'BTC', logo: { logoDomain: 'bitcoin.org' } })];
    await wrapper.vm.$nextTick();

    expect(wrapper.getComponent(BrandLogo).props('domain')).toBe('bitcoin.org');
  });

  it('applies the size and the class it is given', () => {
    const wrapper = mountIcon({ code: 'USD', props: { size: 'size-8', class: 'extra' } });

    expect(wrapper.find('img').classes()).toEqual(expect.arrayContaining(['size-8', 'extra', 'rounded-full']));
  });
});
