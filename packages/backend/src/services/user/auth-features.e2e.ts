import { afterEach, describe, expect, it } from '@jest/globals';
import { makeAuthRequest, makeRequest } from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';

const CLOUD_FEATURES = {
  emailEnabled: false,
  socialProviders: [],
  oidc: null,
  serverVersion: null,
  nativeAppleSignIn: false,
};

const ENV_KEYS = ['APP_VERSION', 'APPLE_NATIVE_SIGN_IN', 'APPLE_APP_BUNDLE_IDENTIFIER'] as const;

const restoreEnvAfterEach = () => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
};

const getFeatures = () => makeRequest({ method: 'get', url: '/auth/features' });

describe('GET /auth/features', () => {
  restoreEnvAfterEach();

  it('reports email, social providers, OIDC and native Apple sign-in disabled when they are not configured', async () => {
    const res = await getFeatures();

    expect(res.statusCode).toBe(200);
    expect(res.body.response).toEqual(CLOUD_FEATURES);
  });

  it('is reachable without a session', async () => {
    global.APP_AUTH_COOKIES = null;

    const res = await getFeatures();

    expect(res.statusCode).toBe(200);
    expect(res.body.response).toEqual(CLOUD_FEATURES);
  });

  it('reports the release version the image was built with', async () => {
    process.env.APP_VERSION = '1.2.3';

    const res = await getFeatures();

    expect(res.body.response.serverVersion).toBe('1.2.3');
  });

  it('reports no version for a build made with an empty one', async () => {
    process.env.APP_VERSION = '';

    const res = await getFeatures();

    expect(res.body.response.serverVersion).toBeNull();
  });

  it('reports native Apple sign-in once an app bundle id is configured, without listing the web flow', async () => {
    process.env.APPLE_APP_BUNDLE_IDENTIFIER = 'com.example.app';

    const res = await getFeatures();

    expect(res.body.response).toEqual({ ...CLOUD_FEATURES, nativeAppleSignIn: true });
  });
});

describe('GET /auth/features on a self-hosted server', () => {
  useSelfHost();
  restoreEnvAfterEach();

  it('reports native Apple sign-in with no Apple configuration, without listing the web flow', async () => {
    const res = await getFeatures();

    expect(res.statusCode).toBe(200);
    expect(res.body.response).toEqual({ ...CLOUD_FEATURES, nativeAppleSignIn: true });
  });

  it('reports native Apple sign-in off when APPLE_NATIVE_SIGN_IN=false', async () => {
    process.env.APPLE_NATIVE_SIGN_IN = 'false';

    const res = await getFeatures();

    expect(res.body.response.nativeAppleSignIn).toBe(false);
  });
});

describe('POST /auth/request-password-reset', () => {
  it('is rejected as disabled when email is not configured', async () => {
    const res = await makeAuthRequest({
      method: 'post',
      url: '/auth/request-password-reset',
      payload: { email: 'someone@example.com' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('RESET_PASSWORD_DISABLED');
  });
});
