import type { AccountGroups } from '@/common/types/models';
import BankConnectionLogo from '@/components/common/bank-connection-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import GroupLogo from '@/components/common/group-logo.vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

// BankConnectionLogo resolves the institution through this endpoint; stub it so mounting
// never reaches the network.
vi.mock('@/api/bank-data-providers', () => ({
  listConnections: vi.fn().mockResolvedValue([]),
}));

type LogoGroup = Pick<
  AccountGroups,
  'name' | 'logoDomain' | 'logoInitials' | 'logoColor' | 'logoIcon' | 'logoImageId' | 'bankDataProviderConnectionId'
>;

const buildGroup = (overrides: Partial<LogoGroup> = {}): LogoGroup => ({
  name: 'Travel',
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  bankDataProviderConnectionId: null,
  ...overrides,
});

const mountLogo = ({
  group,
  size,
  rounded,
  variant,
}: {
  group: LogoGroup;
  size?: 'size-4' | 'size-5' | 'size-7' | 'size-9';
  rounded?: 'md' | 'lg';
  variant?: 'plain' | 'tile';
}) =>
  mount(GroupLogo, {
    props: { group, size, rounded, variant },
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
    },
  });

describe('GroupLogo', () => {
  describe('1. Three-way fallback', () => {
    it('renders the brand logo when the group has a custom domain', () => {
      const wrapper = mountLogo({ group: buildGroup({ logoDomain: 'monobank.ua' }) });

      const brandLogo = wrapper.findComponent(BrandLogo);
      expect(brandLogo.exists()).toBe(true);
      expect(brandLogo.props('domain')).toBe('monobank.ua');
      expect(brandLogo.props('name')).toBe('Travel');
      expect(wrapper.findComponent(BankConnectionLogo).exists()).toBe(false);
    });

    it('renders the brand logo when the group has custom initials', () => {
      const wrapper = mountLogo({ group: buildGroup({ logoInitials: 'TR', logoColor: '#7355be' }) });

      const brandLogo = wrapper.findComponent(BrandLogo);
      expect(brandLogo.exists()).toBe(true);
      expect(brandLogo.props('initials')).toBe('TR');
      expect(brandLogo.props('color')).toBe('#7355be');
    });

    it('falls back to the bank connection logo when the group is bank-linked', () => {
      const wrapper = mountLogo({ group: buildGroup({ bankDataProviderConnectionId: 'conn-1' }) });

      const bankLogo = wrapper.findComponent(BankConnectionLogo);
      expect(bankLogo.exists()).toBe(true);
      expect(bankLogo.props('connectionId')).toBe('conn-1');
      expect(bankLogo.props('alt')).toBe('Travel');
      expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
      expect(wrapper.find('svg').exists()).toBe(false);
    });

    it('falls back to the folder icon when there is neither a custom nor a bank logo', () => {
      const wrapper = mountLogo({ group: buildGroup() });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(false);
      expect(wrapper.findComponent(BankConnectionLogo).exists()).toBe(false);
      expect(wrapper.find('svg').classes()).toContain('lucide-folder');
    });
  });

  describe('2. Precedence', () => {
    it('prefers the custom logo over the bank connection logo', () => {
      const wrapper = mountLogo({
        group: buildGroup({ logoDomain: 'monobank.ua', bankDataProviderConnectionId: 'conn-1' }),
      });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(true);
      expect(wrapper.findComponent(BankConnectionLogo).exists()).toBe(false);
    });

    it('prefers custom initials over the bank connection logo', () => {
      const wrapper = mountLogo({
        group: buildGroup({ logoInitials: 'TR', bankDataProviderConnectionId: 'conn-1' }),
      });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(true);
      expect(wrapper.findComponent(BankConnectionLogo).exists()).toBe(false);
    });
  });

  describe('3. Sizing and rounding', () => {
    it('rounds the custom logo tile to "lg" by default', () => {
      const wrapper = mountLogo({ group: buildGroup({ logoDomain: 'monobank.ua' }) });

      const classes = wrapper.findComponent(BrandLogo).classes();
      expect(classes).toContain('rounded-lg');
      expect(classes).not.toContain('rounded-md');
    });

    it('rounds the custom logo tile to "md" when asked', () => {
      const wrapper = mountLogo({ group: buildGroup({ logoDomain: 'monobank.ua' }), rounded: 'md' });

      const classes = wrapper.findComponent(BrandLogo).classes();
      expect(classes).toContain('rounded-md');
      expect(classes).not.toContain('rounded-lg');
    });

    it('applies the requested size to every branch', () => {
      const brandWrapper = mountLogo({ group: buildGroup({ logoDomain: 'monobank.ua' }), size: 'size-7' });
      expect(brandWrapper.findComponent(BrandLogo).classes()).toContain('size-7');

      const bankWrapper = mountLogo({ group: buildGroup({ bankDataProviderConnectionId: 'conn-1' }), size: 'size-7' });
      expect(bankWrapper.findComponent(BankConnectionLogo).props('size')).toBe('size-7');
    });

    it('keeps the empty-state folder icon below the slot size at the larger sizes', () => {
      expect(mountLogo({ group: buildGroup(), size: 'size-4' }).find('svg').classes()).toContain('size-4');
      expect(mountLogo({ group: buildGroup(), size: 'size-7' }).find('svg').classes()).toContain('size-5');
    });
  });

  describe('4. Tile variant', () => {
    it('frames the empty state in a muted square', () => {
      const wrapper = mountLogo({ group: buildGroup(), size: 'size-9', variant: 'tile' });

      expect(wrapper.classes()).toEqual(expect.arrayContaining(['bg-muted', 'size-9', 'rounded-lg']));
      expect(wrapper.find('svg').classes()).toContain('lucide-folder');
    });

    it('insets the bank logo inside the muted square', () => {
      const wrapper = mountLogo({
        group: buildGroup({ bankDataProviderConnectionId: 'conn-1' }),
        size: 'size-9',
        variant: 'tile',
      });

      expect(wrapper.classes()).toContain('bg-muted');
      expect(wrapper.findComponent(BankConnectionLogo).props('size')).toBe('size-5');
    });

    it('renders the custom logo unframed, ignoring the tile wrapper', () => {
      const wrapper = mountLogo({
        group: buildGroup({ logoDomain: 'monobank.ua' }),
        size: 'size-9',
        variant: 'tile',
      });

      expect(wrapper.findComponent(BrandLogo).exists()).toBe(true);
      expect(wrapper.classes()).not.toContain('bg-muted');
    });
  });
});
