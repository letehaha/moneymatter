import { AI_FEATURE, API_RESPONSE_STATUS } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import * as helpers from '@tests/helpers';
import { GEMINI_API_URL, VALID_GEMINI_API_KEY, rejectIfWrongModel } from '@tests/mocks/gemini/mock-api';
import { randomUUID } from 'crypto';
import { HttpResponse, delay, http } from 'msw';

const EXPECTED_MODEL = FALLBACK_SERVER_MODELS[AI_FEATURE.categorization].model;

function mockGeminiAnswer({ text, delayMs = 0 }: { text: string; delayMs?: number }) {
  global.mswMockServer.use(
    http.post(GEMINI_API_URL, async ({ request }) => {
      const modelMismatch = rejectIfWrongModel({ request, expectedModel: EXPECTED_MODEL });
      if (modelMismatch) return modelMismatch;
      await delay(delayMs);
      return HttpResponse.json({
        candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP', index: 0 }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      });
    }),
  );
}

function startMappingJob() {
  return helpers.makeRequest({
    method: 'post',
    url: '/import/ai-map-categories',
    payload: { sourceCategories: ['Some Source'] },
    followBackgroundJob: false,
  });
}

async function waitForJob({ jobId }: { jobId: string }) {
  let response = await helpers.getBackgroundJob({ jobId });
  while (response.statusCode === 202) {
    await helpers.sleep(50);
    response = await helpers.getBackgroundJob({ jobId });
  }
  return response;
}

describe('GET /background-jobs/:jobId', () => {
  let originalGeminiApiKey: string | undefined;

  beforeEach(() => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it('answers 202 while the job runs, then replays its final response', async () => {
    mockGeminiAnswer({ text: 's1:none', delayMs: 500 });

    const started = await startMappingJob();
    expect(started.statusCode).toBe(202);
    const jobId: string = started.body.response.backgroundJobId;

    const pending = await helpers.getBackgroundJob({ jobId });
    expect(pending.statusCode).toBe(202);
    expect(pending.body.response.backgroundJobId).toBe(jobId);

    const finished = await waitForJob({ jobId });
    expect(finished.statusCode).toBe(200);
    expect(finished.body.response.mappings).toEqual({ 'Some Source': null });

    const replayed = await helpers.getBackgroundJob({ jobId });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.body.response.mappings).toEqual({ 'Some Source': null });
  });

  it('attaches an identical request to the running job and starts a new one once it finished', async () => {
    mockGeminiAnswer({ text: 's1:none', delayMs: 500 });

    const first = await startMappingJob();
    const duplicate = await startMappingJob();
    const jobId: string = first.body.response.backgroundJobId;

    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.body.response.backgroundJobId).toBe(jobId);

    await waitForJob({ jobId });
    const afterFinish = await startMappingJob();

    expect(afterFinish.body.response.backgroundJobId).not.toBe(jobId);
  });

  it('replays the error status and envelope of a job that failed', async () => {
    mockGeminiAnswer({ text: 'nothing parseable here' });

    const started = await startMappingJob();
    const finished = await waitForJob({ jobId: started.body.response.backgroundJobId });

    expect(finished.statusCode).toBeGreaterThanOrEqual(400);
    expect(finished.body.status).toBe(API_RESPONSE_STATUS.error);
    expect(finished.body.response.message).toEqual(expect.any(String));
  });

  it('returns 404 for an unknown job', async () => {
    const response = await helpers.getBackgroundJob({ jobId: randomUUID() });

    expect(response.statusCode).toBe(404);
  });

  it("does not expose another user's job", async () => {
    mockGeminiAnswer({ text: 's1:none' });
    const started = await startMappingJob();
    const jobId: string = started.body.response.backgroundJobId;
    await waitForJob({ jobId });
    const { cookies } = await helpers.signUpSecondUser();

    const response = await helpers.asUser({ cookies, fn: () => helpers.getBackgroundJob({ jobId }) });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed job id', async () => {
    const response = await helpers.getBackgroundJob({ jobId: 'not-a-uuid' });

    expect(response.statusCode).toBe(422);
  });
});
