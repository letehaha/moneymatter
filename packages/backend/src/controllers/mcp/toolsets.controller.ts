import { createController } from '@controllers/helpers/controller-factory';
import { getToolsetSummaries } from '@services/mcp/get-toolset-summaries';
import { z } from 'zod';

export const getMcpToolsetsController = createController(z.object({}), async () => {
  return { data: getToolsetSummaries() };
});
