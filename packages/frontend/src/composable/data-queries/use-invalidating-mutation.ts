import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

/**
 * A write that refreshes the caches it invalidates before `mutateAsync` resolves, so a caller
 * can close its dialog knowing the list behind it is already fresh.
 *
 * Error copy prefers the server's own message so a validation failure or a write lock held by a
 * restore says what it is, with the operation-specific key as the fallback.
 */
export const useInvalidatingMutation = <TData, TVariables>({
  mutationFn,
  invalidateKeys,
  successKey,
  successMessage,
  errorKey,
  silentErrorCodes,
  persistentErrorId,
  onSuccess,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  invalidateKeys: QueryKey[];
  /** Omit for writes whose result is obvious from the UI updating. */
  successKey?: string;
  /** Takes precedence over `successKey` when the copy depends on the response. */
  successMessage?: (data: TData) => string;
  errorKey: string;
  /** Codes the caller renders itself (e.g. inline), so the generic toast is skipped. */
  silentErrorCodes?: API_ERROR_CODES[];
  /** Keeps the error toast up until dismissed, under this id so the caller can clear it on retry. */
  persistentErrorId?: string;
  onSuccess?: (data: TData) => void;
}) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { addNotification, addSuccessNotification, addErrorNotification } = useNotificationCenter();

  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess: (data) => {
      const message = successMessage ? successMessage(data) : successKey && t(successKey);
      if (message) addSuccessNotification(message);
      onSuccess?.(data);
      return Promise.all(invalidateKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (error) => {
      // The API client already logs the user out and announces an expired session on 401,
      // so a second toast here would blame this operation for it.
      if (isApiErrorWithCode(error, API_ERROR_CODES.unauthorized)) return;
      // The API client already toasted the 402 with a "See plans" action.
      if (isApiErrorWithCode(error, API_ERROR_CODES.planRequired)) return;
      if (silentErrorCodes?.some((code) => isApiErrorWithCode(error, code))) return;
      const text = extractApiErrorMessage(error) || t(errorKey);
      if (!persistentErrorId) return addErrorNotification(text);
      addNotification({ id: persistentErrorId, text, type: NotificationType.error, persistent: true });
    },
  });
};
