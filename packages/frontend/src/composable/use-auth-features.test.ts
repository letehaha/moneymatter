import { type AuthFeaturesResponse, OAUTH_PROVIDER } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const query = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('@tanstack/vue-query', () => ({ useQuery: () => query }));
vi.mock('@/api/auth', () => ({ getAuthFeatures: vi.fn() }));

import { useAuthFeatures } from './use-auth-features';

const setup = ({ data }: { data?: AuthFeaturesResponse }) => {
  query.data = ref(data);
  return useAuthFeatures();
};

const features = (overrides: Partial<AuthFeaturesResponse> = {}): AuthFeaturesResponse => ({
  emailEnabled: false,
  socialProviders: [],
  oidc: null,
  ...overrides,
});

describe('useAuthFeatures', () => {
  it('enables only the configured social providers', () => {
    const { isProviderEnabled, hasAnyOAuthProvider } = setup({
      data: features({ socialProviders: [OAUTH_PROVIDER.google] }),
    });

    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.google })).toBe(true);
    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.github })).toBe(false);
    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.apple })).toBe(false);
    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.oidc })).toBe(false);
    expect(hasAnyOAuthProvider.value).toBe(true);
  });

  it('reports no providers when nothing is configured', () => {
    const { hasAnyOAuthProvider } = setup({ data: features() });

    expect(hasAnyOAuthProvider.value).toBe(false);
  });

  it('counts an OIDC-only server as having a provider', () => {
    const { isProviderEnabled, hasAnyOAuthProvider } = setup({ data: features({ oidc: { name: 'Pocket ID' } }) });

    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.oidc })).toBe(true);
    expect(hasAnyOAuthProvider.value).toBe(true);
  });

  it('hides providers until features load', () => {
    const { isProviderEnabled, hasAnyOAuthProvider } = setup({});

    expect(isProviderEnabled({ provider: OAUTH_PROVIDER.google })).toBe(false);
    expect(hasAnyOAuthProvider.value).toBe(false);
  });
});
