import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import {
  type ResolveSuggestionsAction,
  resolveTrackerSuggestions,
} from '@services/budgets/smart-tracking/resolve-suggestions';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.object({ suggestionIds: uniqueRecordIds({ min: 1 }) }),
});

const buildController = ({ action }: { action: ResolveSuggestionsAction }) =>
  createController(schema, async ({ user, params, body }) => ({
    data: await resolveTrackerSuggestions({
      userId: user.id,
      budgetId: params.id,
      suggestionIds: body.suggestionIds,
      action,
    }),
  }));

export const acceptSuggestions = buildController({ action: 'accept' });
export const rejectSuggestions = buildController({ action: 'reject' });
export const restoreSuggestions = buildController({ action: 'restore' });
