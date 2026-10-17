import { HttpResponse, http } from 'msw';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

/** Only the models tests price; every other model reads as unknown. */
export const MODELS_DEV_CATALOG = {
  anthropic: {
    models: {
      'claude-haiku-4-5': { name: 'Claude Haiku 4.5', cost: { input: 1, output: 5 }, limit: { context: 200_000 } },
      'claude-haiku-5-5': { name: 'Claude Haiku 5.5', cost: { input: 1, output: 5 }, limit: { context: 200_000 } },
    },
  },
  google: {
    models: {
      'gemini-3.8-flash': {
        name: 'Gemini 3.8 Flash',
        cost: { input: 0.75, output: 3.75 },
        limit: { context: 1_048_576, output: 65_536 },
        modalities: { input: ['text', 'image', 'pdf'] },
        structured_output: true,
      },
      'gemini-3.5-flash-lite': {
        name: 'Gemini 3.5 Flash Lite',
        cost: { input: 0.3, output: 2.5 },
        limit: { context: 1_048_576 },
      },
      'gemma-4-31b-it': { name: 'Gemma 4 31B', cost: { input: 0, output: 0 }, limit: { context: 262_144 } },
    },
  },
};

export const modelsDevUnavailableMock = () =>
  http.get(MODELS_DEV_URL, () => HttpResponse.json({ error: 'unavailable' }, { status: 503 }));

export const modelsDevHandlers = [http.get(MODELS_DEV_URL, () => HttpResponse.json(MODELS_DEV_CATALOG))];
