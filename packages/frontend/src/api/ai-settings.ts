import { api } from '@/api/_api';
import {
  AICliProvider,
  AIConnectionInfo,
  AIFeatureStatus,
  type AIFeaturesStatusResponse,
  AI_FEATURE,
  CliAiAvailability,
  CliAuthSessionInfo,
  CreateAIConnectionBody,
  ListAIConnectionModelsBody,
  ListAIConnectionModelsResponse,
  SetAIFeatureConfigBody,
  TestAIConnectionBody,
  TestAIConnectionResponse,
  UpdateAIConnectionBody,
} from '@bt/shared/types';

// ===== Feature Configuration =====

export const getAiFeaturesStatus = async (): Promise<AIFeaturesStatusResponse> => {
  return api.get('/user/settings/ai/features');
};

/** `connectionId: null` picks the included server model. */
export const setAiFeatureConfig = async ({
  feature,
  connectionId,
}: SetAIFeatureConfigBody & { feature: AI_FEATURE }): Promise<AIFeatureStatus> => {
  return api.put(`/user/settings/ai/features/${feature}`, { connectionId });
};

export const resetAiFeatureConfig = async ({ feature }: { feature: AI_FEATURE }): Promise<AIFeatureStatus> => {
  return api.delete(`/user/settings/ai/features/${feature}`);
};

// ===== Custom Instructions =====

export interface CustomInstructionsResponse {
  instructions: string | null;
}

export const getCustomInstructions = async (): Promise<CustomInstructionsResponse> => {
  return api.get('/user/settings/ai/custom-instructions');
};

export const setCustomInstructions = async ({
  instructions,
}: {
  instructions: string;
}): Promise<{ success: boolean }> => {
  return api.put('/user/settings/ai/custom-instructions', { instructions });
};

// ===== Connections =====

export const getAiConnections = async (): Promise<AIConnectionInfo[]> => {
  return api.get('/user/settings/ai/connections');
};

export const createAiConnection = async (body: CreateAIConnectionBody): Promise<AIConnectionInfo> => {
  return api.post('/user/settings/ai/connections', body);
};

/** Partial update. `apiKey` omitted keeps the stored key, `null` removes it, a string replaces it. */
export const updateAiConnection = async ({
  id,
  ...body
}: UpdateAIConnectionBody & { id: string }): Promise<AIConnectionInfo> => {
  return api.put(`/user/settings/ai/connections/${id}`, body);
};

export const deleteAiConnection = async ({ id }: { id: string }): Promise<{ success: boolean }> => {
  return api.delete(`/user/settings/ai/connections/${id}`);
};

/** Returns the reordered list. */
export const setDefaultAiConnection = async ({ id }: { id: string }): Promise<AIConnectionInfo[]> => {
  return api.post(`/user/settings/ai/connections/${id}/default`);
};

export const testAiConnection = async (body: TestAIConnectionBody): Promise<TestAIConnectionResponse> => {
  return api.post('/user/settings/ai/connections/test', body);
};

export const listAiConnectionModels = async (
  body: ListAIConnectionModelsBody,
): Promise<ListAIConnectionModelsResponse> => {
  return api.post('/user/settings/ai/connections/models', body);
};

// ===== Subscription (CLI) providers =====

/** Answers every signed-in user; `available: false` carries the reason instead of an error. */
export const getCliAiAvailability = async (): Promise<CliAiAvailability> => {
  return api.get('/user/settings/ai/cli/availability');
};

/** Resolves once the sign-in page URL (and, for Codex, the device code) is known. */
export const startCliAuthSession = async ({ provider }: { provider: AICliProvider }): Promise<CliAuthSessionInfo> => {
  return api.post('/user/settings/ai/cli/auth-sessions', { provider });
};

/** Polled while a sign-in is running, so a failed poll must not toast. */
export const getCliAuthSession = async ({ id }: { id: string }): Promise<CliAuthSessionInfo> => {
  return api.get(`/user/settings/ai/cli/auth-sessions/${id}`, {}, { silent: true });
};

/** Claude only: the code the sign-in page showed. */
export const submitCliAuthCode = async ({ id, code }: { id: string; code: string }): Promise<CliAuthSessionInfo> => {
  return api.post(`/user/settings/ai/cli/auth-sessions/${id}/code`, { code });
};

export const cancelCliAuthSession = async ({ id }: { id: string }): Promise<void> => {
  await api.delete(`/user/settings/ai/cli/auth-sessions/${id}`, undefined, { silent: true });
};
