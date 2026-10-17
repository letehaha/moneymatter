import { api } from '@/api/_api';
import {
  AIConnectionInfo,
  AIFeatureStatus,
  type AIFeaturesStatusResponse,
  AI_FEATURE,
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
