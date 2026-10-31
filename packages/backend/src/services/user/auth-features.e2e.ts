import { describe, expect, it } from '@jest/globals';
import { makeAuthRequest, makeRequest } from '@tests/helpers';

describe('GET /auth/features', () => {
  it('reports email and OIDC disabled when they are not configured', async () => {
    const res = await makeRequest({ method: 'get', url: '/auth/features' });

    expect(res.statusCode).toBe(200);
    expect(res.body.response).toEqual({ emailEnabled: false, oidc: null });
  });

  it('is reachable without a session', async () => {
    global.APP_AUTH_COOKIES = null;

    const res = await makeRequest({ method: 'get', url: '/auth/features' });

    expect(res.statusCode).toBe(200);
    expect(res.body.response).toEqual({ emailEnabled: false, oidc: null });
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
