import AccountLogo from '@/components/common/account-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import { ACCOUNT_CATEGORIES, type AccountModel } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

type LogoAccount = Pick<AccountModel, 'name' | 'logoDomain' | 'logoInitials' | 'logoColor' | 'accountCategory'>;

const buildAccount = (overrides: Partial<LogoAccount> = {}): LogoAccount => ({
  name: 'Everyday',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  accountCategory: ACCOUNT_CATEGORIES.general,
  ...overrides,
});

const mountLogo = ({
  account,
  category,
  solid,
  attrs,
}: {
  account: LogoAccount;
  category?: ACCOUNT_CATEGORIES;
  solid?: boolean;
  attrs?: Record<string, unknown>;
}) => mount(AccountLogo, { props: { account, category, solid }, attrs });

describe('AccountLogo', () => {
  describe('1. Brand branch', () => {
    it('renders the brand logo when the account has a custom domain', () => {
      const wrapper = mountLogo({ account: buildAccount({ logoDomain: 'monobank.ua' }) });

      const brandLogo = wrapper.findComponent(BrandLogo);
      expect(brandLogo.exists()).toBe(true);
      expect(brandLogo.props('domain')).toBe('monobank.ua');
      expect(brandLogo.props('name')).toBe('Everyday');
      expect(wrapper.find('svg').exists()).toBe(false);
    });

    it('renders the brand logo when the account has custom initials', () => {
      const wrapper = mountLogo({ account: buildAccount({ logoInitials: 'EV', logoColor: '#7355be' }) });

      const brandLogo = wrapper.findComponent(BrandLogo);
      expect(brandLogo.exists()).toBe(true);
      expect(brandLogo.props('initials')).toBe('EV');
      expect(brandLogo.props('color')).toBe('#7355be');
    });

    it('passes the consumer class through to the brand logo', () => {
      const wrapper = mountLogo({
        account: buildAccount({ logoDomain: 'monobank.ua' }),
        attrs: { class: 'size-12' },
      });

      expect(wrapper.findComponent(BrandLogo).classes()).toContain('size-12');
    });
  });

  describe('2. Account-type chip fallback', () => {
    it('renders the category chip when the account has no custom logo', () => {
      const wrapper = mountLogo({ account: buildAccount({ accountCategory: ACCOUNT_CATEGORIES.saving }) });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
      expect(wrapper.classes()).toContain('bg-account-saving/15');
      expect(wrapper.find('svg').classes()).toContain('lucide-piggy-bank');
    });

    it('renders the credit-card chip for a credit card account', () => {
      const wrapper = mountLogo({ account: buildAccount({ accountCategory: ACCOUNT_CATEGORIES.creditCard }) });

      expect(wrapper.classes()).toContain('bg-account-credit/15');
      expect(wrapper.find('svg').classes()).toContain('lucide-credit-card');
    });

    it('renders an opaque chip when solid', () => {
      const wrapper = mountLogo({ account: buildAccount({ accountCategory: ACCOUNT_CATEGORIES.saving }), solid: true });

      expect(wrapper.classes()).toEqual(expect.arrayContaining(['bg-account-saving', 'text-background']));
      expect(wrapper.classes()).not.toContain('bg-account-saving/15');
    });

    it('passes the consumer class through to the chip', () => {
      const wrapper = mountLogo({ account: buildAccount(), attrs: { class: 'size-12' } });

      expect(wrapper.classes()).toEqual(expect.arrayContaining(['size-12', 'rounded-lg']));
    });
  });

  describe('3. Category prop', () => {
    it('overrides account.accountCategory for the chip', () => {
      const wrapper = mountLogo({
        account: buildAccount({ accountCategory: ACCOUNT_CATEGORIES.general }),
        category: ACCOUNT_CATEGORIES.saving,
      });

      expect(wrapper.classes()).toContain('bg-account-saving/15');
      expect(wrapper.classes()).not.toContain('bg-account-checking/15');
      expect(wrapper.find('svg').classes()).toContain('lucide-piggy-bank');
    });

    it('falls back to account.accountCategory when omitted', () => {
      const wrapper = mountLogo({ account: buildAccount({ accountCategory: ACCOUNT_CATEGORIES.cash }) });

      expect(wrapper.classes()).toContain('bg-account-cash/15');
      expect(wrapper.find('svg').classes()).toContain('lucide-banknote');
    });

    it('does not affect the brand branch', () => {
      const wrapper = mountLogo({
        account: buildAccount({ logoDomain: 'monobank.ua' }),
        category: ACCOUNT_CATEGORIES.saving,
      });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(true);
      expect(wrapper.find('svg').exists()).toBe(false);
    });
  });
});
