import {
  AIConnectionInfo,
  AIFeatureStatus,
  AIFeaturesStatusResponse,
  AI_FEATURE,
  AI_PROVIDER,
  CreateAIConnectionBody,
  FireSettings,
  ListAIConnectionModelsBody,
  ListAIConnectionModelsResponse,
  TestAIConnectionBody,
  TestAIConnectionResponse,
  UpdateAIConnectionBody,
  WipeDataSharedResources,
} from '@bt/shared/types';
import UserSettings, { type StoredConnection } from '@models/user-settings.model';
import Users from '@models/users.model';
import { getUserSettings as apiGetUserSettings } from '@root/services/user-settings/get-user-settings';
import {
  getOnboardingState as apiGetOnboardingState,
  updateOnboardingState as apiUpdateOnboardingState,
} from '@root/services/user-settings/onboarding';
import { patchUserSettings as apiPatchUserSettings } from '@root/services/user-settings/patch-settings';
import { updateUserSettings as apiUpdateUserSettings } from '@root/services/user-settings/update-settings';
import {
  CUSTOM_ENDPOINT_BASE_URL,
  CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
  CUSTOM_ENDPOINT_MODEL,
} from '@tests/mocks/openai-compatible/mock-api';
import { OPENAI_LISTED_MODELS, VALID_OPENAI_API_KEY } from '@tests/mocks/openai/mock-api';

import { CustomResponse, makeRequest } from './common';

export async function getUserSettings<R extends boolean | undefined = undefined>({ raw }: { raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof apiGetUserSettings>>, R>({
    method: 'get',
    url: '/user/settings',
    raw,
  });
}

export async function updateUserSettings<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: {
  // `fire` is accepted so specs can prove PUT ignores it.
  settings: Parameters<typeof apiUpdateUserSettings>[0]['settings'] & { fire?: FireSettings };
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiUpdateUserSettings>>, R>({
    method: 'put',
    url: '/user/settings',
    payload: payload.settings,
    raw,
  });
}

export async function patchUserSettings<R extends boolean | undefined = undefined>({
  raw,
  patch,
}: {
  patch: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiPatchUserSettings>>, R>({
    method: 'patch',
    url: '/user/settings',
    payload: patch,
    raw,
  });
}

export async function getOnboarding<R extends boolean | undefined = undefined>({ raw }: { raw?: R }) {
  return makeRequest<Awaited<ReturnType<typeof apiGetOnboardingState>>, R>({
    method: 'get',
    url: '/user/settings/onboarding',
    raw,
  });
}

export async function updateOnboarding<R extends boolean | undefined = undefined>({
  raw,
  onboardingState,
}: {
  onboardingState: Omit<Parameters<typeof apiUpdateOnboardingState>[0], 'userId'>['onboardingState'];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiUpdateOnboardingState>>, R>({
    method: 'put',
    url: '/user/settings/onboarding',
    payload: onboardingState,
    raw,
  });
}

export async function deleteUserAccount(): Promise<CustomResponse<void>> {
  return makeRequest<void>({
    method: 'delete',
    url: '/user/delete',
  });
}

/**
 * Returns the raw envelope so callers can assert on `statusCode`, `body.response.code`,
 * and `body.response.details` — needed for the 409 sharing-acknowledgement branch.
 */
export async function wipeUserData({
  acknowledgeSharing,
}: {
  acknowledgeSharing?: boolean;
} = {}): Promise<
  CustomResponse<{
    code?: string;
    message?: string;
    details?: { sharedResources?: WipeDataSharedResources };
  }>
> {
  return makeRequest({
    method: 'post',
    url: '/user/wipe-data',
    payload: { acknowledgeSharing: acknowledgeSharing ?? false },
  });
}

// AI connection helpers

export async function getAiConnections<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<AIConnectionInfo[], R>({
    method: 'get',
    url: '/user/settings/ai/connections',
    raw,
  });
}

export async function createAiConnection<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: CreateAIConnectionBody & { raw?: R }) {
  return makeRequest<AIConnectionInfo, R>({
    method: 'post',
    url: '/user/settings/ai/connections',
    payload,
    raw,
  });
}

/** Omitted fields keep their stored value. `apiKey`: omit to keep, null to remove, string to replace. */
export async function updateAiConnection<R extends boolean | undefined = undefined>({
  id,
  raw,
  ...payload
}: UpdateAIConnectionBody & { id: string; raw?: R }) {
  return makeRequest<AIConnectionInfo, R>({
    method: 'put',
    url: `/user/settings/ai/connections/${id}`,
    payload,
    raw,
  });
}

export async function deleteAiConnection<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'delete',
    url: `/user/settings/ai/connections/${id}`,
    raw,
  });
}

/** Moves the connection to the front of the list and returns the reordered list. */
export async function setDefaultAiConnection<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<AIConnectionInfo[], R>({
    method: 'post',
    url: `/user/settings/ai/connections/${id}/default`,
    raw,
  });
}

/** With `connectionId` every omitted field falls back to that saved connection, including its key. */
export async function testAiConnection<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: TestAIConnectionBody & { raw?: R }) {
  return makeRequest<TestAIConnectionResponse, R>({
    method: 'post',
    url: '/user/settings/ai/connections/test',
    payload,
    raw,
  });
}

export async function listAiConnectionModels<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: ListAIConnectionModelsBody & { raw?: R }) {
  return makeRequest<ListAIConnectionModelsResponse, R>({
    method: 'post',
    url: '/user/settings/ai/connections/models',
    payload,
    raw,
  });
}

// AI Feature configuration helpers

export async function getAiFeaturesStatus<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<AIFeaturesStatusResponse, R>({
    method: 'get',
    url: '/user/settings/ai/features',
    raw,
  });
}

export async function getAiFeatureConfig<R extends boolean | undefined = undefined>({
  feature,
  raw,
}: {
  feature: AI_FEATURE;
  raw?: R;
}) {
  return makeRequest<AIFeatureStatus, R>({
    method: 'get',
    url: `/user/settings/ai/features/${feature}`,
    raw,
  });
}

/** `connectionId: null` pins the included server model. */
export async function setAiFeatureConfig<R extends boolean | undefined = undefined>({
  feature,
  connectionId,
  raw,
}: {
  feature: AI_FEATURE;
  connectionId: string | null;
  raw?: R;
}) {
  return makeRequest<AIFeatureStatus, R>({
    method: 'put',
    url: `/user/settings/ai/features/${feature}`,
    payload: { connectionId },
    raw,
  });
}

/** Clears the pick, so the feature goes back to automatic. */
export async function resetAiFeatureConfig<R extends boolean | undefined = undefined>({
  feature,
  raw,
}: {
  feature: AI_FEATURE;
  raw?: R;
}) {
  return makeRequest<AIFeatureStatus, R>({
    method: 'delete',
    url: `/user/settings/ai/features/${feature}`,
    raw,
  });
}

// AI Custom Instructions helpers

export async function getCustomInstructions<R extends boolean | undefined = undefined>({ raw }: { raw?: R }) {
  return makeRequest<{ instructions: string | null }, R>({
    method: 'get',
    url: '/user/settings/ai/custom-instructions',
    raw,
  });
}

export async function setCustomInstructions<R extends boolean | undefined = undefined>({
  instructions,
  raw,
}: {
  instructions: string;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'put',
    url: '/user/settings/ai/custom-instructions',
    payload: { instructions },
    raw,
  });
}

// AI settings fixtures: shared setup and stored-state reads for the AI e2e suites

/** The seeded user every e2e case authenticates as. */
export async function getTestUserId(): Promise<number> {
  const user = await Users.findOne({ where: { username: 'test1' } });
  if (!user) throw new Error('Test user not found');
  return user.id;
}

export async function readStoredConnections({ userId }: { userId: number }) {
  const settings = await UserSettings.findOne({ where: { userId } });
  return settings?.settings?.ai?.connections ?? [];
}

/** Arranges stored states no endpoint reaches, such as a missing or unreadable key. */
export async function patchStoredConnection({
  connectionId,
  patch,
}: {
  connectionId: string;
  patch: Partial<StoredConnection>;
}): Promise<void> {
  const userId = await getTestUserId();
  const settings = await UserSettings.findOne({ where: { userId } });
  const ai = settings?.settings.ai;
  if (!settings || !ai?.connections) throw new Error('Expected the test user to have AI connections by now');

  settings.settings = {
    ...settings.settings,
    ai: {
      ...ai,
      connections: ai.connections.map((connection) =>
        connection.id === connectionId ? { ...connection, ...patch } : connection,
      ),
    },
  };
  await settings.save();
}

export async function readStoredFeatureConfigs({ userId }: { userId: number }) {
  const settings = await UserSettings.findOne({ where: { userId } });
  return settings?.settings?.ai?.featureConfigs ?? [];
}

export const FIRST_CONNECTION_NAME = 'Home Ollama';
export const SECOND_CONNECTION_NAME = 'Studio vLLM';
export const SECOND_CONNECTION_MODEL = 'qwen2.5';

/** Both custom connections answer through msw. The caller picks self-host or cloud mode first. */
export async function createFirstConnection({ apiKey }: { apiKey?: string } = {}) {
  return createAiConnection({
    provider: AI_PROVIDER.custom,
    name: FIRST_CONNECTION_NAME,
    baseUrl: CUSTOM_ENDPOINT_BASE_URL,
    model: CUSTOM_ENDPOINT_MODEL,
    apiKey,
    raw: true,
  });
}

export async function createSecondConnection({ apiKey }: { apiKey?: string } = {}) {
  return createAiConnection({
    provider: AI_PROVIDER.custom,
    name: SECOND_CONNECTION_NAME,
    baseUrl: CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
    model: SECOND_CONNECTION_MODEL,
    apiKey,
    raw: true,
  });
}

export async function createOpenAiConnection({
  name = 'GPT fast',
  model = OPENAI_LISTED_MODELS[0]!,
  apiKey = VALID_OPENAI_API_KEY,
}: { name?: string; model?: string; apiKey?: string } = {}) {
  return createAiConnection({ provider: AI_PROVIDER.openai, name, model, apiKey, raw: true });
}

/** The typed helpers describe success bodies only, so an error message needs its own read. */
export function errorMessage({ response }: { response: { body: unknown } }): string | undefined {
  return (response.body as { response?: { message?: string } }).response?.message;
}
