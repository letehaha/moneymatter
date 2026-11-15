import { AI_FEATURE, AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import {
  FIRST_CONNECTION_NAME,
  createFirstConnection,
  getTestUserId,
  readStoredChatRetention,
  readStoredConnections,
  readStoredFeatureConfigs,
  seedStoredChatRetention,
} from '@tests/helpers/user-settings';
import { VALID_CUSTOM_ENDPOINT_API_KEY } from '@tests/mocks/openai-compatible/mock-api';

/** Link-local metadata address that the outbound URL guard rejects. */
const SMUGGLED_BASE_URL = 'http://169.254.169.254';
const SMUGGLED_CONNECTION_ID = 'smuggled-not-a-uuid';

/** Shaped like a stored connection, with a base URL the outbound guard rejects and an id no route can match. */
function buildSmuggledAiSettings() {
  const now = new Date().toISOString();

  return {
    connections: [
      {
        id: SMUGGLED_CONNECTION_ID,
        provider: AI_PROVIDER.custom,
        name: 'Metadata',
        baseUrl: SMUGGLED_BASE_URL,
        model: 'gpt-4o-mini',
        createdAt: now,
        status: 'valid' as const,
        lastValidatedAt: now,
      },
    ],
    featureConfigs: [{ feature: AI_FEATURE.categorization, connectionId: SMUGGLED_CONNECTION_ID }],
  };
}

/** Goes through the connection route, so the stored row carries real ciphertext. */
async function createConnectionWithKey() {
  const connection = await createFirstConnection({ apiKey: VALID_CUSTOM_ENDPOINT_API_KEY });
  await helpers.setAiFeatureConfig({ feature: AI_FEATURE.categorization, connectionId: connection.id, raw: true });

  return connection;
}

/** PUT with a body the typed helper cannot express, because the contract leaves these slices out. */
function putRawSettings({ settings }: { settings: Record<string, unknown> }) {
  return helpers.makeRequest({ method: 'put', url: '/user/settings', payload: settings });
}

/** Every `keyEncrypted` found anywhere in a response body, at any depth. */
function collectKeyMaterial({ value }: { value: unknown }): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectKeyMaterial({ value: item }));

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) =>
      key === 'keyEncrypted' ? [String(nested)] : collectKeyMaterial({ value: nested }),
    );
  }

  return [];
}

describe('Settings slices owned by their own endpoints', () => {
  // The mock connection's host never resolves, so the outbound guard has to be off to save it.
  useSelfHostWithoutServerAiKeys();

  describe('PUT /user/settings', () => {
    it('ignores smuggled ai.connections and ai.featureConfigs', async () => {
      // A settings row already exists, so this exercises the merge branch.
      await helpers.updateUserSettings({ raw: true, settings: { locale: 'en' } });

      const response = await putRawSettings({
        settings: {
          locale: 'uk',
          includeCreditLimitInStats: true,
          ai: buildSmuggledAiSettings(),
        },
      });
      expect(response.statusCode).toBe(200);

      const userId = await getTestUserId();
      expect(await readStoredConnections({ userId })).toHaveLength(0);
      expect(await readStoredFeatureConfigs({ userId })).toHaveLength(0);
      expect(await helpers.getAiConnections({ raw: true })).toHaveLength(0);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.includeCreditLimitInStats).toBe(true);
    });

    it('ignores smuggled ai.connections and ai.featureConfigs on the very first write', async () => {
      // The first write seeds the row straight from the payload, a separate branch from the merge.
      const response = await putRawSettings({
        settings: { locale: 'en', ai: buildSmuggledAiSettings() },
      });
      expect(response.statusCode).toBe(200);

      const userId = await getTestUserId();
      expect(await readStoredConnections({ userId })).toHaveLength(0);
      expect(await readStoredFeatureConfigs({ userId })).toHaveLength(0);
      expect(await helpers.getAiConnections({ raw: true })).toHaveLength(0);
    });

    it('keeps every service-owned slice when the client sends settings back', async () => {
      // The wipe scenario: a page reads settings, changes one field and sends the whole cached object back.
      const userId = await getTestUserId();
      const connection = await createConnectionWithKey();
      const keyEncrypted = (await readStoredConnections({ userId }))[0]?.keyEncrypted;
      expect(keyEncrypted).toEqual(expect.any(String));
      await helpers.updateOnboarding({ raw: true, onboardingState: { isDismissed: true } });

      const fetched = await helpers.getUserSettings({ raw: true });
      const response = await putRawSettings({
        settings: {
          ...fetched,
          locale: 'uk',
          onboarding: { completedTasks: [], isDismissed: false, dismissedAt: null },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(collectKeyMaterial({ value: response.body })).toHaveLength(0);

      const stored = await readStoredConnections({ userId });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.name).toBe(FIRST_CONNECTION_NAME);
      expect(stored[0]!.keyEncrypted).toBe(keyEncrypted);
      expect(await readStoredFeatureConfigs({ userId })).toEqual([
        { feature: AI_FEATURE.categorization, connectionId: connection.id },
      ]);

      const listed = await helpers.getAiConnections({ raw: true });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.name).toBe(FIRST_CONNECTION_NAME);
      expect(listed[0]!.hasApiKey).toBe(true);

      const onboarding = await helpers.getOnboarding({ raw: true });
      expect(onboarding.isDismissed).toBe(true);

      const reFetched = await helpers.getUserSettings({ raw: true });
      expect(reFetched.locale).toBe('uk');

      const updated = await helpers.updateUserSettings({
        raw: true,
        settings: {
          locale: 'en',
          ai: { customInstructions: 'Prefer concise answers' },
        },
      });

      expect(updated.ai?.customInstructions).toBe('Prefer concise answers');
      expect(updated.ai?.connections).toHaveLength(1);
      expect(updated.ai?.featureConfigs).toHaveLength(1);
      expect(collectKeyMaterial({ value: updated })).toHaveLength(0);

      const afterSiblingUpdate = await helpers.getUserSettings({ raw: true });
      expect(afterSiblingUpdate.ai?.customInstructions).toBe('Prefer concise answers');

      const storedAfterSiblingUpdate = await readStoredConnections({ userId });
      expect(storedAfterSiblingUpdate).toHaveLength(1);
      expect(storedAfterSiblingUpdate[0]!.name).toBe(FIRST_CONNECTION_NAME);
    }, 30_000);

    it('leaves a stored ai.chat.retentionDays unchanged, as a stale cached settings object would carry it', async () => {
      await helpers.updateUserSettings({ raw: true, settings: { locale: 'en' } });
      await seedStoredChatRetention({ retentionDays: 7 });
      const userId = await getTestUserId();

      const response = await putRawSettings({
        settings: { locale: 'uk', ai: { customInstructions: 'Be brief', chat: { retentionDays: 90 } } },
      });
      expect(response.statusCode).toBe(200);

      expect(await readStoredChatRetention({ userId })).toBe(7);
      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.ai?.customInstructions).toBe('Be brief');
      expect(fetched.ai?.chat?.retentionDays).toBe(7);
    });

    it('does not store ai.chat.retentionDays on the very first write', async () => {
      const response = await putRawSettings({
        settings: { locale: 'en', ai: { chat: { retentionDays: 90 } } },
      });
      expect(response.statusCode).toBe(200);

      expect(await readStoredChatRetention({ userId: await getTestUserId() })).toBeUndefined();
    });

    it('rejects a payload that is invalid outside the ignored slices', async () => {
      const response = await putRawSettings({ settings: { locale: 'klingon' } });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('GET /user/settings', () => {
    it('returns no encrypted key material anywhere', async () => {
      const userId = await getTestUserId();
      await createConnectionWithKey();

      const fetched = await helpers.getUserSettings({ raw: true });

      // The slice comes back, so an empty scan isn't just the slice being missing.
      expect(fetched.ai?.connections).toHaveLength(1);
      expect(collectKeyMaterial({ value: fetched })).toHaveLength(0);

      const [stored] = await readStoredConnections({ userId });
      expect(stored?.keyEncrypted).toEqual(expect.any(String));
    });

    it('returns no encrypted key material for a user who never stored any', async () => {
      const fetched = await helpers.getUserSettings({ raw: true });

      expect(collectKeyMaterial({ value: fetched })).toHaveLength(0);
    });
  });

  describe('PATCH /user/settings', () => {
    it('leaves a stored ai.chat.retentionDays unchanged', async () => {
      await helpers.updateUserSettings({ raw: true, settings: { locale: 'en' } });
      await seedStoredChatRetention({ retentionDays: 7 });
      const userId = await getTestUserId();

      const response = await helpers.patchUserSettings({
        patch: { includeCreditLimitInStats: true, ai: { chat: { retentionDays: 90 } } },
      });
      expect(response.statusCode).toBe(200);

      expect(response.body.response.includeCreditLimitInStats).toBe(true);
      expect(response.body.response.ai?.chat?.retentionDays).toBe(7);
      expect(await readStoredChatRetention({ userId })).toBe(7);

      const siblingPatch = await helpers.patchUserSettings({
        raw: true,
        patch: { ai: { customInstructions: 'Prefer concise answers' } },
      });
      expect(siblingPatch.ai?.chat?.retentionDays).toBe(7);
      expect(await readStoredChatRetention({ userId })).toBe(7);
    });

    it('never writes ai.connections or ai.featureConfigs, whatever the rest of the patch does', async () => {
      const userId = await getTestUserId();

      const response = await helpers.patchUserSettings({
        patch: {
          includeCreditLimitInStats: true,
          ai: buildSmuggledAiSettings(),
        },
      });
      expect(response.statusCode).toBe(200);

      const patched = response.body.response;
      expect(patched.includeCreditLimitInStats).toBe(true);
      expect(patched.ai?.connections ?? []).toHaveLength(0);
      expect(await helpers.getAiConnections({ raw: true })).toHaveLength(0);
      expect(await readStoredConnections({ userId })).toHaveLength(0);
      expect(await readStoredFeatureConfigs({ userId })).toHaveLength(0);

      const connection = await createConnectionWithKey();

      const replaceAttempt = await helpers.patchUserSettings({
        patch: { ai: buildSmuggledAiSettings() },
      });
      expect(replaceAttempt.statusCode).toBe(200);

      const stored = await readStoredConnections({ userId });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.name).toBe(FIRST_CONNECTION_NAME);
      expect(stored.some((candidate) => candidate.baseUrl === SMUGGLED_BASE_URL)).toBe(false);
      expect(await readStoredFeatureConfigs({ userId })).toEqual([
        { feature: AI_FEATURE.categorization, connectionId: connection.id },
      ]);

      const listed = await helpers.getAiConnections({ raw: true });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.name).toBe(FIRST_CONNECTION_NAME);

      const withSiblingKey = await helpers.patchUserSettings({
        raw: true,
        patch: { ai: { customInstructions: 'Prefer concise answers' } },
      });
      expect(withSiblingKey.ai?.customInstructions).toBe('Prefer concise answers');
      expect(withSiblingKey.ai?.connections).toHaveLength(1);
      expect(collectKeyMaterial({ value: withSiblingKey })).toHaveLength(0);

      const storedAfterSiblingPatch = await readStoredConnections({ userId });
      expect(storedAfterSiblingPatch).toHaveLength(1);
      expect(storedAfterSiblingPatch[0]!.name).toBe(FIRST_CONNECTION_NAME);
    }, 30_000);
  });
});
