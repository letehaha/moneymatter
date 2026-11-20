import { MCP_TOOLSET_SCOPES } from '@bt/shared/types';
import { API_RESPONSE_STATUS } from '@bt/shared/types/api';
import { afterEach, describe, expect, it } from '@jest/globals';
import { app } from '@root/app';
import { API_PREFIX, BETTER_AUTH_BASE_URL } from '@root/config';
import { CustomResponse } from '@tests/helpers';
import * as mcpHelpers from '@tests/helpers/mcp';
import request from 'supertest';

describe('MCP Connected Apps API', () => {
  afterEach(async () => {
    await mcpHelpers.cleanupTestOAuthData();
  });

  it('returns 401 when not authenticated, on both the list and the revoke endpoint', async () => {
    const savedCookies = global.APP_AUTH_COOKIES;
    global.APP_AUTH_COOKIES = '';

    const listRes: CustomResponse<unknown> = await mcpHelpers.getConnectedApps({ raw: false });
    expect(listRes.statusCode).toBe(401);
    expect(listRes.body.status).toBe(API_RESPONSE_STATUS.error);

    const revokeRes: CustomResponse<unknown> = await mcpHelpers.revokeConnectedApp({
      clientId: 'some-client',
      raw: false,
    });
    expect(revokeRes.statusCode).toBe(401);
    expect(revokeRes.body.status).toBe(API_RESPONSE_STATUS.error);

    global.APP_AUTH_COOKIES = savedCookies;
  });

  describe('GET /user/settings/mcp/connected-apps', () => {
    it('returns empty array when no apps are connected', async () => {
      const apps = await mcpHelpers.getConnectedApps({ raw: true });

      expect(apps).toEqual([]);
    });

    it('returns each connected app with its fields, and a null lastUsedAt when it has no access tokens', async () => {
      const withToken = await mcpHelpers.createTestOAuthClient();
      await mcpHelpers.createTestOAuthConsent({ clientId: withToken.clientId });
      await mcpHelpers.createTestOAuthAccessToken({ clientId: withToken.clientId });

      const withoutToken = await mcpHelpers.createTestOAuthClient({
        id: 'test-internal-client-id-2',
        clientId: 'test-public-client-id-2',
        name: 'Second Test MCP App',
      });
      await mcpHelpers.createTestOAuthConsent({ id: 'test-consent-id-2', clientId: withoutToken.clientId });

      const apps = await mcpHelpers.getConnectedApps({ raw: true });

      expect(apps).toHaveLength(2);
      expect(apps.find((item) => item.clientId === withToken.clientId)).toMatchObject({
        clientId: withToken.clientId,
        name: withToken.name,
        scopes: expect.arrayContaining(['finance:read', 'profile:read']),
        connectedAt: expect.any(String),
        lastUsedAt: expect.any(String),
      });
      expect(apps.find((item) => item.clientId === withoutToken.clientId)!.lastUsedAt).toBeNull();
    });
  });

  describe('DELETE /user/settings/mcp/connected-apps/:clientId', () => {
    it('returns error for non-existent client', async () => {
      const res: CustomResponse<unknown> = await mcpHelpers.revokeConnectedApp({
        clientId: 'non-existent-client-id',
        raw: false,
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe(API_RESPONSE_STATUS.error);
    });

    it('revokes a connected app, removing it from the list and deleting its auth-DB records', async () => {
      const client = await mcpHelpers.createTestOAuthClient();
      await mcpHelpers.createTestOAuthConsent({ clientId: client.clientId });
      // Tokens key off the public clientId, exactly as better-auth writes them.
      await mcpHelpers.createTestOAuthAccessToken({ clientId: client.clientId });
      await mcpHelpers.createTestOAuthRefreshToken({ clientId: client.clientId });

      const appsBefore = await mcpHelpers.getConnectedApps({ raw: true });
      expect(appsBefore).toHaveLength(1);
      const countsBefore = await mcpHelpers.getTestOAuthRecordCounts({
        clientId: client.clientId,
      });
      expect(countsBefore.accessTokens).toBe(1);
      expect(countsBefore.refreshTokens).toBe(1);
      expect(countsBefore.consents).toBe(1);

      const res: CustomResponse<{ success: boolean }> = await mcpHelpers.revokeConnectedApp({
        clientId: client.clientId,
        raw: false,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.response).toEqual({ success: true });

      const appsAfter = await mcpHelpers.getConnectedApps({ raw: true });
      expect(appsAfter).toEqual([]);
      const countsAfter = await mcpHelpers.getTestOAuthRecordCounts({
        clientId: client.clientId,
      });
      // The access token (72h TTL) and refresh token (60d TTL) must both be gone —
      // otherwise the integration keeps authenticating after the user revokes it.
      expect(countsAfter.accessTokens).toBe(0);
      expect(countsAfter.refreshTokens).toBe(0);
      expect(countsAfter.consents).toBe(0);
    });
  });
});

describe('GET /auth/oauth2/client-info', () => {
  afterEach(async () => {
    await mcpHelpers.cleanupTestOAuthData();
  });

  it('returns the client name for a valid client_id', async () => {
    const client = await mcpHelpers.createTestOAuthClient({ name: 'My Test App' });

    const res = await mcpHelpers.getOAuthClientInfo({ clientId: client.clientId });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.success);
    expect(res.body.response).toEqual({ name: 'My Test App' });
  });

  it('returns null name when client_id does not exist', async () => {
    const res = await mcpHelpers.getOAuthClientInfo({ clientId: 'non-existent-client' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.success);
    expect(res.body.response).toEqual({ name: null });
  });

  it('returns null name when the client exists but has a null name', async () => {
    // createTestOAuthClient defaults name to 'Test MCP App', so we insert
    // directly with NULL to test the null-name path.
    const { authPool } = await import('@config/auth');
    await authPool.query(
      `INSERT INTO "ba_oauth_client" (id, "clientId", name, "redirectUris", scopes, "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      ['test-internal-client-id', 'test-public-client-id', 'https://example.com/callback', '["finance:read"]'],
    );

    const res = await mcpHelpers.getOAuthClientInfo({ clientId: 'test-public-client-id' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.success);
    expect(res.body.response).toEqual({ name: null });
  });

  it('returns 400 when client_id query param is missing', async () => {
    const res = await mcpHelpers.getOAuthClientInfo({} as unknown as { clientId: string });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.error);
  });
});

describe('OAuth Discovery Endpoints', () => {
  it('returns valid OAuth authorization server metadata from both the root and path-aware forms', async () => {
    for (const url of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      `/.well-known/oauth-authorization-server${API_PREFIX}/auth`,
    ]) {
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        issuer: `${BETTER_AUTH_BASE_URL}${API_PREFIX}/auth`,
        authorization_endpoint: expect.stringContaining('/oauth2/authorize'),
        token_endpoint: expect.stringContaining('/oauth2/token'),
        registration_endpoint: expect.stringContaining('/oauth2/register'),
        revocation_endpoint: expect.stringContaining('/oauth2/revoke'),
        response_types_supported: ['code'],
        grant_types_supported: expect.arrayContaining(['authorization_code', 'refresh_token']),
        code_challenge_methods_supported: ['S256'],
        scopes_supported: expect.arrayContaining(['finance:read', 'profile:read', ...MCP_TOOLSET_SCOPES]),
      });
      expect(res.body.token_endpoint_auth_methods_supported).toEqual(
        expect.arrayContaining(['client_secret_basic', 'none']),
      );
      expect(res.body.authorization_endpoint).toBe(`${res.body.issuer}/oauth2/authorize`);
    }
  });

  it('returns valid OAuth protected resource metadata from both the root and path-aware forms', async () => {
    for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        resource: expect.stringContaining('/mcp'),
        authorization_servers: expect.any(Array),
        scopes_supported: expect.arrayContaining([
          'finance:read',
          'profile:read',
          'offline_access',
          ...MCP_TOOLSET_SCOPES,
        ]),
        bearer_methods_supported: ['header'],
      });
      expect(res.body.authorization_servers).toEqual([`${BETTER_AUTH_BASE_URL}${API_PREFIX}/auth`]);
    }
  });
});
