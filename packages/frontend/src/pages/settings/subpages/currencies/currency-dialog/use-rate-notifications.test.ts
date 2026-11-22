import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRateNotifications } from './use-rate-notifications';

const { mockAddSuccess, mockAddWarning, mockAddError, mockCapture } = vi.hoisted(() => ({
  mockAddSuccess: vi.fn(),
  mockAddWarning: vi.fn(),
  mockAddError: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockAddSuccess,
    addWarningNotification: mockAddWarning,
    addErrorNotification: mockAddError,
  }),
}));
vi.mock('@/lib/sentry', () => ({ captureException: mockCapture }));
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('useRateNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('notifyRateSaved', () => {
    it('confirms the change with no warning when every balance refreshed', () => {
      useRateNotifications().notifyRateSaved({ message: 'Saved', remeasure: { updated: 3, failed: 0 } });

      expect(mockAddSuccess).toHaveBeenCalledWith('Saved');
      expect(mockAddWarning).not.toHaveBeenCalled();
    });

    it('warns when some balances kept their old base value', () => {
      useRateNotifications().notifyRateSaved({ message: 'Saved', remeasure: { updated: 1, failed: 2 } });

      expect(mockAddWarning).toHaveBeenCalledWith('settings.currencies.exchangeRate.balancesNotRefreshed');
    });
  });

  describe('notifyRateFailed', () => {
    it("shows the API's message and reports nothing", () => {
      const error = new ApiErrorResponseError('bad', { code: API_ERROR_CODES.validationError, message: 'Refused' });
      useRateNotifications().notifyRateFailed({ error, fallback: 'Failed', flow: 'test' });

      expect(mockAddError).toHaveBeenCalledWith('Refused');
      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('reports a failure outside the API and shows the fallback', () => {
      const error = new TypeError('boom');
      useRateNotifications().notifyRateFailed({ error, fallback: 'Failed', flow: 'test' });

      expect(mockAddError).toHaveBeenCalledWith('Failed');
      expect(mockCapture).toHaveBeenCalledWith({ error, context: { flow: 'test' } });
    });

    it('stays silent for a failure the API client already handled', () => {
      const error = new ApiErrorResponseError('plan', { code: API_ERROR_CODES.planRequired, message: 'Upgrade' });
      useRateNotifications().notifyRateFailed({ error, fallback: 'Failed', flow: 'test' });

      expect(mockAddError).not.toHaveBeenCalled();
      expect(mockCapture).not.toHaveBeenCalled();
    });
  });
});
