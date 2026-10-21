import { AI_FEATURE, AI_PROVIDER, FEATURES, PLANS } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { FALLBACK_SERVER_MODELS } from '@services/ai/resolution-ladder';
import { clearServedModelsCache } from '@services/ai/served-models-cache';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import { enableServerModel, runAsCloud, useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import {
  FIRST_CONNECTION_NAME,
  SECOND_CONNECTION_MODEL,
  SECOND_CONNECTION_NAME,
  createFirstConnection,
  createSecondConnection,
  getTestUserId,
  readStoredFeatureConfigs,
} from '@tests/helpers/user-settings';
import { createCallsCounter } from '@tests/mocks/helpers';
import { MODELS_DEV_CATALOG, MODELS_DEV_URL, modelsDevUnavailableMock } from '@tests/mocks/models-dev/mock-api';
import {
  CUSTOM_ENDPOINT_LISTED_MODELS,
  CUSTOM_ENDPOINT_LISTING_BASE_URL,
  CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
  CUSTOM_ENDPOINT_MODEL,
  CUSTOM_ENDPOINT_UNKNOWN_MODEL,
  getCustomEndpointCallCountingMock,
} from '@tests/mocks/openai-compatible/mock-api';
import { HttpResponse, http } from 'msw';
import { randomUUID } from 'node:crypto';

const FEATURE = AI_FEATURE.categorization;
const FIRST_MODEL_ID = `custom/${CUSTOM_ENDPOINT_MODEL}`;
const SECOND_MODEL_ID = `custom/${SECOND_CONNECTION_MODEL}`;

describe('AI feature settings', () => {
  useSelfHostWithoutServerAiKeys();

  describe('GET /user/settings/ai/features', () => {
    it('reports every feature as unserved without connections or a server model', async () => {
      const { features } = await helpers.getAiFeaturesStatus({ raw: true });

      expect(features.map(({ feature }) => feature).toSorted()).toEqual(Object.values(AI_FEATURE).toSorted());
      for (const status of features) {
        expect(status).toMatchObject({
          isConfigured: false,
          servedBy: null,
          modelId: '',
          modelName: '',
          usingUserKey: false,
          serverModelName: null,
        });
        expect(status.connectionId).toBeUndefined();
      }
    });

    it('serves every unconfigured feature from the first connection', async () => {
      const first = await createFirstConnection();
      await createSecondConnection();

      const { features } = await helpers.getAiFeaturesStatus({ raw: true });

      for (const status of features) {
        expect(status).toMatchObject({
          isConfigured: false,
          servedBy: 'connection',
          connectionId: first.id,
          connectionName: FIRST_CONNECTION_NAME,
          modelId: FIRST_MODEL_ID,
          modelName: CUSTOM_ENDPOINT_MODEL,
          usingUserKey: true,
        });
      }
    });

    it('falls back to the included server model when the user has no connections', async () => {
      enableServerModel();

      const { features } = await helpers.getAiFeaturesStatus({ raw: true });

      // Chat has no included model: it needs one of the user's own connections.
      expect(features.find(({ feature }) => feature === AI_FEATURE.chat)).toMatchObject({ servedBy: null });

      for (const status of features.filter(({ feature }) => feature !== AI_FEATURE.chat)) {
        expect(status).toMatchObject({ isConfigured: false, servedBy: 'server', usingUserKey: false });
        expect(status.serverModelName).toEqual(expect.any(String));
        expect(status.modelName).toBe(status.serverModelName);
      }
    });

    it('names, prices and describes the answering model from the public model catalog, fetching it once', async () => {
      enableServerModel();
      const catalogCalls = createCallsCounter(global.mswMockServer, MODELS_DEV_URL);

      await helpers.getAiFeatureConfig({ feature: AI_FEATURE.statementParsing, raw: true });
      const status = await helpers.getAiFeatureConfig({ feature: AI_FEATURE.statementParsing, raw: true });
      const { name, cost, limit, modalities } = MODELS_DEV_CATALOG.google.models['gemini-3.8-flash'];

      expect(status).toMatchObject({
        servedBy: 'server',
        modelName: name,
        serverModelName: name,
        pricing: { inputPerMillion: cost.input, outputPerMillion: cost.output },
        capabilities: { inputs: modalities.input, maxOutputTokens: limit.output, structuredOutput: true },
      });
      expect(catalogCalls.count).toBe(1);
    });

    it('reports the price and capabilities as unknown when the model catalog is unreachable, without refetching it', async () => {
      enableServerModel();
      global.mswMockServer.use(modelsDevUnavailableMock());
      const catalogCalls = createCallsCounter(global.mswMockServer, MODELS_DEV_URL);

      await helpers.getAiFeatureConfig({ feature: AI_FEATURE.statementParsing, raw: true });
      const status = await helpers.getAiFeatureConfig({ feature: AI_FEATURE.statementParsing, raw: true });

      expect(status).toMatchObject({
        servedBy: 'server',
        modelName: FALLBACK_SERVER_MODELS[AI_FEATURE.statementParsing]!.model,
        pricing: null,
        capabilities: null,
      });
      expect(catalogCalls.count).toBe(1);
    });
  });

  describe('GET /user/settings/ai/features/:feature', () => {
    it('offers the server model to receipt parsing on an invoice-matching trial, and to nothing else', async () => {
      // Cloud mode, where the plan decides who gets the server model.
      runAsCloud();
      enableServerModel();
      await helpers.setUserBilling({ plan: PLANS.essential });

      const receiptParsing = await helpers.getAiFeatureConfig({ feature: AI_FEATURE.receiptParsing, raw: true });
      const categorization = await helpers.getAiFeatureConfig({ feature: AI_FEATURE.categorization, raw: true });

      expect(receiptParsing).toMatchObject({ servedBy: 'server', serverModelName: expect.any(String) });
      expect(categorization).toMatchObject({ servedBy: null, serverModelName: null });
    });
  });

  describe('PUT /user/settings/ai/features/:feature', () => {
    it('pins a connection other than the default and stores only its id', async () => {
      const userId = await getTestUserId();
      const first = await createFirstConnection();
      const second = await createSecondConnection();

      const status = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: second.id, raw: true });

      expect(status).toMatchObject({
        feature: FEATURE,
        isConfigured: true,
        configuredConnectionId: second.id,
        servedBy: 'connection',
        connectionId: second.id,
        connectionName: SECOND_CONNECTION_NAME,
        modelId: SECOND_MODEL_ID,
        modelName: SECOND_CONNECTION_MODEL,
        usingUserKey: true,
      });
      expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: second.id }]);

      const otherFeature = await helpers.getAiFeatureConfig({ feature: AI_FEATURE.statementParsing, raw: true });
      expect(otherFeature).toMatchObject({ isConfigured: false, connectionId: first.id });
    });

    it('makes no outbound call when a feature is pointed at a connection', async () => {
      await createFirstConnection();
      const second = await createSecondConnection();

      let connectionCalls = 0;
      global.mswMockServer.use(
        getCustomEndpointCallCountingMock({
          baseUrl: CUSTOM_ENDPOINT_LOOPBACK_BASE_URL,
          onCall: () => {
            connectionCalls += 1;
          },
        }),
      );

      const response = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: second.id });

      expect(response.statusCode).toBe(200);
      expect(connectionCalls).toBe(0);
    });

    describe('model override', () => {
      it('stores the model next to the connection and reports it as what answers', async () => {
        const userId = await getTestUserId();
        await createFirstConnection();
        const second = await createSecondConnection();

        const status = await helpers.setAiFeatureConfig({
          feature: FEATURE,
          connectionId: second.id,
          modelId: CUSTOM_ENDPOINT_MODEL,
          raw: true,
        });

        expect(status).toMatchObject({
          isConfigured: true,
          configuredConnectionId: second.id,
          configuredModelId: CUSTOM_ENDPOINT_MODEL,
          connectionId: second.id,
          modelId: FIRST_MODEL_ID,
          modelName: CUSTOM_ENDPOINT_MODEL,
        });
        expect(await readStoredFeatureConfigs({ userId })).toEqual([
          { feature: FEATURE, connectionId: second.id, modelId: CUSTOM_ENDPOINT_MODEL },
        ]);
        expect(await helpers.getAiFeatureConfig({ feature: FEATURE, raw: true })).toMatchObject({
          configuredModelId: CUSTOM_ENDPOINT_MODEL,
        });
      });

      it('refuses a model the connection cannot serve and keeps the stored pick', async () => {
        const userId = await getTestUserId();
        const first = await createFirstConnection();
        const second = await createSecondConnection();
        await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: first.id, raw: true });

        const response = await helpers.setAiFeatureConfig({
          feature: FEATURE,
          connectionId: second.id,
          modelId: CUSTOM_ENDPOINT_UNKNOWN_MODEL,
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: first.id }]);
      });

      describe('validation cost', () => {
        beforeEach(() => {
          clearServedModelsCache();
        });

        /** A connection whose endpoint lists its models, counting what the endpoint is asked. */
        const arrangeListingConnection = async () => {
          const counts = { listings: 0, completions: 0 };
          global.mswMockServer.use(
            http.get(`${CUSTOM_ENDPOINT_LISTING_BASE_URL}/models`, () => {
              counts.listings += 1;
              return HttpResponse.json({
                object: 'list',
                data: CUSTOM_ENDPOINT_LISTED_MODELS.map((id) => ({ id, object: 'model' })),
              });
            }),
            getCustomEndpointCallCountingMock({
              baseUrl: CUSTOM_ENDPOINT_LISTING_BASE_URL,
              onCall: () => {
                counts.completions += 1;
              },
            }),
          );
          const connection = await helpers.createAiConnection({
            provider: AI_PROVIDER.custom,
            name: 'Listing server',
            baseUrl: CUSTOM_ENDPOINT_LISTING_BASE_URL,
            model: CUSTOM_ENDPOINT_MODEL,
            raw: true,
          });
          // Saving the connection probed it already.
          counts.listings = 0;
          counts.completions = 0;

          return { connection, counts };
        };

        it('checks a model against the provider listing, without a generate call', async () => {
          const { connection, counts } = await arrangeListingConnection();

          const accepted = await helpers.setAiFeatureConfig({
            feature: FEATURE,
            connectionId: connection.id,
            modelId: `${CUSTOM_ENDPOINT_MODEL}:70b`,
          });
          const refused = await helpers.setAiFeatureConfig({
            feature: FEATURE,
            connectionId: connection.id,
            modelId: 'not-in-the-listing',
          });

          expect(accepted.statusCode).toBe(200);
          expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
          expect(counts.completions).toBe(0);
        });

        it('remembers the listing for the next picks', async () => {
          const { connection, counts } = await arrangeListingConnection();

          for (const modelId of [`${CUSTOM_ENDPOINT_MODEL}:70b`, 'qwen2.5', `${CUSTOM_ENDPOINT_MODEL}:70b`]) {
            await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: connection.id, modelId });
          }

          expect(counts.listings).toBe(1);
        });

        it('spends the probe budget, and refuses once it is used up, when the provider has no listing', async () => {
          await createFirstConnection();
          const second = await createSecondConnection();
          const userId = await getTestUserId();
          const PROBE_BUDGET = 15;
          for (let used = 0; used < PROBE_BUDGET; used++) {
            await RateLimitService.checkRateLimit(`ai-connection-probe:user:${userId}`, 60, PROBE_BUDGET);
          }

          const response = await helpers.setAiFeatureConfig({
            feature: FEATURE,
            connectionId: second.id,
            modelId: CUSTOM_ENDPOINT_MODEL,
          });

          expect(response.statusCode).toBe(ERROR_CODES.TooManyRequests);
        });

        it('leaves the probe budget alone when the listing answers', async () => {
          const { connection } = await arrangeListingConnection();
          const userId = await getTestUserId();
          const PROBE_BUDGET = 15;
          for (let used = 0; used < PROBE_BUDGET; used++) {
            await RateLimitService.checkRateLimit(`ai-connection-probe:user:${userId}`, 60, PROBE_BUDGET);
          }

          const response = await helpers.setAiFeatureConfig({
            feature: FEATURE,
            connectionId: connection.id,
            modelId: `${CUSTOM_ENDPOINT_MODEL}:70b`,
          });

          expect(response.statusCode).toBe(200);
        });
      });

      it('refuses a model for the included server model', async () => {
        enableServerModel();
        await createFirstConnection();

        const response = await helpers.setAiFeatureConfig({
          feature: FEATURE,
          connectionId: null,
          modelId: CUSTOM_ENDPOINT_MODEL,
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('stores the connection default as no override, so it follows the connection when that changes', async () => {
        const userId = await getTestUserId();
        await createFirstConnection();
        const second = await createSecondConnection();

        const status = await helpers.setAiFeatureConfig({
          feature: FEATURE,
          connectionId: second.id,
          modelId: SECOND_CONNECTION_MODEL,
          raw: true,
        });

        expect(status.configuredModelId).toBeUndefined();
        expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: second.id }]);
      });

      it('drops the override when the pick is saved again without one', async () => {
        const userId = await getTestUserId();
        await createFirstConnection();
        const second = await createSecondConnection();
        await helpers.setAiFeatureConfig({
          feature: FEATURE,
          connectionId: second.id,
          modelId: CUSTOM_ENDPOINT_MODEL,
          raw: true,
        });

        const status = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: second.id, raw: true });

        expect(status).toMatchObject({ modelId: SECOND_MODEL_ID });
        expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: second.id }]);
      });
    });

    it('rejects an unknown connection and keeps the stored pick', async () => {
      const userId = await getTestUserId();
      const first = await createFirstConnection();
      await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: first.id, raw: true });

      const response = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: randomUUID() });

      expect(response.statusCode).toBe(404);
      expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: first.id }]);
    });

    it('refuses the server model when the user cannot use it', async () => {
      const userId = await getTestUserId();
      await createFirstConnection();

      const response = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: null });

      expect(response.statusCode).toBe(422);
      expect(await readStoredFeatureConfigs({ userId })).toEqual([]);
    });

    it('pins the server model over the default connection', async () => {
      const userId = await getTestUserId();
      enableServerModel();
      await createFirstConnection();

      const status = await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: null, raw: true });

      expect(status).toMatchObject({
        isConfigured: true,
        configuredConnectionId: null,
        servedBy: 'server',
        usingUserKey: false,
      });
      expect(status.connectionId).toBeUndefined();
      expect(await readStoredFeatureConfigs({ userId })).toEqual([{ feature: FEATURE, connectionId: null }]);
    });

    it('reports a server pick as unconfigured once the server model is gone', async () => {
      enableServerModel();
      const first = await createFirstConnection();
      await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: null, raw: true });

      delete process.env.GEMINI_API_KEY;

      const status = await helpers.getAiFeatureConfig({ feature: FEATURE, raw: true });

      expect(status).toMatchObject({
        isConfigured: false,
        servedBy: 'connection',
        connectionId: first.id,
        serverModelName: null,
      });
    });
  });

  describe('DELETE /user/settings/ai/features/:feature', () => {
    it('clears the pick so the feature goes back to the default connection', async () => {
      const userId = await getTestUserId();
      const first = await createFirstConnection();
      const second = await createSecondConnection();
      await helpers.setAiFeatureConfig({ feature: FEATURE, connectionId: second.id, raw: true });

      const status = await helpers.resetAiFeatureConfig({ feature: FEATURE, raw: true });

      expect(status).toMatchObject({ isConfigured: false, servedBy: 'connection', connectionId: first.id });
      expect(await readStoredFeatureConfigs({ userId })).toEqual([]);
    });
  });

  describe('tracker matching on the smart tracking entitlement', () => {
    const feature = AI_FEATURE.trackerMatching;

    it('offers and pins the server model during a smart tracking trial', async () => {
      runAsCloud();
      enableServerModel();
      await helpers.setUserBilling({ plan: PLANS.essential });
      await helpers.startFeatureTrial({ feature: FEATURES.smart_tracking, raw: true });

      expect(await helpers.getAiFeatureConfig({ feature, raw: true })).toMatchObject({ servedBy: 'server' });
      expect((await helpers.setAiFeatureConfig({ feature, connectionId: null })).statusCode).toBe(200);
    });

    it('refuses the server model without smart tracking', async () => {
      runAsCloud();
      enableServerModel();
      await helpers.setUserBilling({ plan: PLANS.essential });

      expect(await helpers.getAiFeatureConfig({ feature, raw: true })).toMatchObject({ servedBy: null });
      expect((await helpers.setAiFeatureConfig({ feature, connectionId: null })).statusCode).toBe(422);
    });
  });
});
