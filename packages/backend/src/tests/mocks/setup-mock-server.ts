import { setupServer } from 'msw/node';

import { anthropicHandlers } from './anthropic/mock-api';
import { enableBankingHandlers } from './enablebanking/mock-api';
import { exchangeRatesHandlers } from './exchange-rates/use-mock-api';
import { geminiHandlers } from './gemini/mock-api';
import { logoDevHandlers } from './logo-dev/mock-api';
import { lunchflowHandlers } from './lunchflow/mock-api';
import { modelsDevHandlers } from './models-dev/mock-api';
import { monobankHandlers } from './monobank/mock-api';
import { openAiCompatibleHandlers } from './openai-compatible/mock-api';
import { openAiHandlers } from './openai/mock-api';
import { simplefinHandlers } from './simplefin/mock-api';
import { walutomatHandlers } from './walutomat/mock-api';
import { webPushHandlers } from './web-push/mock-api';

export const setupMswServer = () =>
  setupServer(
    ...exchangeRatesHandlers,
    ...monobankHandlers,
    ...enableBankingHandlers,
    ...lunchflowHandlers,
    ...walutomatHandlers,
    ...simplefinHandlers,
    ...anthropicHandlers,
    ...openAiHandlers,
    ...geminiHandlers,
    ...logoDevHandlers,
    ...openAiCompatibleHandlers,
    ...modelsDevHandlers,
    ...webPushHandlers,
  );
