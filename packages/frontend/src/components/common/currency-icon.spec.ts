import CurrencyIcon from '@/components/common/currency-icon.vue';
import { registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useCurrenciesStore } from '@/stores/currencies';
import type { UserCurrencyModel } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

const LOGO = 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png';

const buildHolding = ({ code, logoUrl = null }: { code: string; logoUrl?: string | null }) =>
  ({ currencyCode: code, logoUrl }) as UserCurrencyModel;

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
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('USD');
  });

  it('shows the logo of a custom currency that has one', () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC', logoUrl: LOGO })] });

    expect(wrapper.find('img').attributes('src')).toBe(LOGO);
    expect(wrapper.find('[data-testid="currency-icon-monogram"]').exists()).toBe(false);
  });

  it('shows a logo handed in as a prop over the saved one, and none for null', () => {
    const OTHER = 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png';
    const holdings = [buildHolding({ code: 'BTC', logoUrl: LOGO })];

    expect(
      mountIcon({ code: 'BTC', holdings, props: { logoUrl: OTHER } })
        .find('img')
        .attributes('src'),
    ).toBe(OTHER);

    const cleared = mountIcon({ code: 'BTC', holdings, props: { logoUrl: null } });
    expect(cleared.find('img').exists()).toBe(false);
    expect(cleared.get('[data-testid="currency-icon-monogram"]').text()).toBe('₿');
  });

  it('falls back to the monogram when the logo fails to load', async () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC', logoUrl: LOGO })] });

    await wrapper.find('img').trigger('error');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('₿');
  });

  it('draws the symbol of a custom currency without a logo as its monogram', () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC' })] });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('₿');
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('BTC');
  });

  it('draws the code of a custom currency without a symbol or a logo', () => {
    const wrapper = mountIcon({ code: 'USDT', holdings: [buildHolding({ code: 'USDT' })] });

    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('USDT');
  });

  it('shows the monogram, not the flag, for a custom code the user does not hold', () => {
    const wrapper = mountIcon({ code: 'USDT' });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('USDT');
  });

  it("uses the owner's definition passed as meta for a custom code outside the registry", () => {
    const wrapper = mountIcon({
      code: 'SAT',
      props: { meta: { decimals: 8, symbol: 's', isCustom: true } },
    });

    expect(wrapper.get('[data-testid="currency-icon-monogram"]').text()).toBe('s');
  });

  it('gives a logo that failed another chance when the logo changes', async () => {
    const wrapper = mountIcon({ code: 'BTC', holdings: [buildHolding({ code: 'BTC', logoUrl: LOGO })] });
    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);

    const nextLogo = 'https://coin-images.coingecko.com/coins/images/2/large/other.png';
    useCurrenciesStore().currencies = [buildHolding({ code: 'BTC', logoUrl: nextLogo })];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').attributes('src')).toBe(nextLogo);
  });

  it('applies the size and the class it is given', () => {
    const wrapper = mountIcon({ code: 'USD', props: { size: 'size-8', class: 'extra' } });

    expect(wrapper.find('img').classes()).toEqual(expect.arrayContaining(['size-8', 'extra', 'rounded-full']));
  });
});
