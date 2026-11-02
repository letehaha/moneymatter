import type {
  Confirmation,
  Credentials,
  CredentialsModel,
  Dialog,
  Field,
  Image,
  OBResponse,
  Redirect,
  RedirectHandle,
  Result,
  RoutexClient,
  Selection,
} from 'routex-client';

const INTEGRATION_KEY_PREFIX = 'api-key-integration-';
const POLL_LIMIT_MS = 5 * 60 * 1000;
const MS_PER_SECOND = 1000;

export class YaxiCanceledError extends Error {}
export class YaxiTimeoutError extends Error {}

export interface YaxiLoginForm {
  userId: 'hidden' | 'required' | 'optional';
  password: boolean;
}

export const resolveYaxiLoginForm = ({ credentials }: { credentials: CredentialsModel }): YaxiLoginForm => {
  if (credentials.none) {
    return { userId: credentials.userId && !credentials.full ? 'optional' : 'hidden', password: false };
  }
  if (credentials.full) return { userId: 'required', password: true };
  return { userId: credentials.userId ? 'required' : 'hidden', password: false };
};

export const buildYaxiCredentials = ({
  connectionId,
  form,
  userId,
  password,
}: {
  connectionId: string;
  form: YaxiLoginForm;
  userId: string;
  password: string;
}): Credentials => ({
  connectionId,
  ...(form.userId !== 'hidden' && userId.trim() ? { userId: userId.trim() } : {}),
  ...(form.password ? { password } : {}),
});

export const canSubmitYaxiLogin = ({
  form,
  userId,
  password,
}: {
  form: YaxiLoginForm;
  userId: string;
  password: string;
}): boolean => (form.userId !== 'required' || !!userId.trim()) && (!form.password || !!password);

export const isValidYaxiSecret = ({ secret }: { secret: string }): boolean =>
  secret.length > 0 && secret.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(secret);

export const isYaxiIntegrationKey = ({ keyId }: { keyId: string }): boolean =>
  keyId.trim().startsWith(INTEGRATION_KEY_PREFIX);

export const bytesToBase64 = ({ bytes }: { bytes: Uint8Array }): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

const imageToDataUrl = ({ image }: { image?: Image }): string | undefined =>
  image && `data:${image.mimeType};base64,${bytesToBase64({ bytes: image.data })}`;

interface YaxiStepDisplay {
  message?: string;
  imageUrl?: string;
}

export type YaxiAskStep =
  | ({ kind: 'confirmation' } & YaxiStepDisplay)
  | ({ kind: 'selection'; options: Selection['options'] } & YaxiStepDisplay)
  | ({ kind: 'field'; masked: boolean; minLength?: number; maxLength?: number } & YaxiStepDisplay)
  | { kind: 'redirect'; url: string };

export type YaxiPollingStep = { kind: 'polling'; redirectUrl?: string } & YaxiStepDisplay;

const isResult = (response: OBResponse): response is Result => 'jwt' in response;
const isDialog = (response: OBResponse): response is Dialog => 'input' in response;
const isRedirect = (response: OBResponse): response is Redirect => 'url' in response;
const isRedirectHandle = (response: OBResponse): response is RedirectHandle => 'handle' in response;
const isSelection = (input: Dialog['input']): input is Selection => 'options' in input;
const isField = (input: Dialog['input']): input is Field => 'secrecyLevel' in input;

const waitFor = ({ ms }: { ms: number }) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Walks the bank's interrupts until a Result. `ask` waits for the user; `onPolling` only reports
 * progress. Polling has no failure of its own, so it is bounded by a deadline, restarted whenever
 * the user is asked for something.
 */
export const driveYaxiLogin = async ({
  start,
  client,
  ticket,
  redirectUri,
  ask,
  onPolling,
  signal,
  wait = waitFor,
  now = Date.now,
}: {
  start: Promise<OBResponse>;
  client: Pick<RoutexClient, 'confirmAccounts' | 'respondAccounts' | 'registerRedirectUri'>;
  ticket: string;
  redirectUri: string;
  ask: (step: YaxiAskStep) => Promise<string>;
  onPolling: (step: YaxiPollingStep) => void;
  signal: AbortSignal;
  wait?: (params: { ms: number }) => Promise<void>;
  now?: () => number;
}): Promise<Result> => {
  const abortable = <T>(promise: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new YaxiCanceledError());
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });

  let response = await abortable(start);
  let pollingSince: number | null = null;
  let redirectUrl: string | undefined;

  const askAndRespond = async ({ context, step }: { context: Uint8Array; step: YaxiAskStep }) => {
    pollingSince = null;
    const answer = await abortable(ask(step));
    onPolling({ kind: 'polling' });
    return abortable(client.respondAccounts({ ticket, context, response: answer }));
  };

  while (!isResult(response)) {
    if (isRedirect(response) || isRedirectHandle(response)) {
      const url: URL = isRedirect(response)
        ? response.url
        : await abortable(client.registerRedirectUri({ ticket, handle: response.handle, redirectUri }));
      redirectUrl = url.href;
      await abortable(ask({ kind: 'redirect', url: redirectUrl }));
      pollingSince = now();
      onPolling({ kind: 'polling', redirectUrl });
      response = await abortable(client.confirmAccounts({ ticket, context: response.context }));
    } else if (isDialog(response)) {
      const { input, message } = response;
      const display = { message, imageUrl: imageToDataUrl({ image: response.image }) };

      if (isSelection(input)) {
        response = await askAndRespond({
          context: input.context,
          step: { kind: 'selection', options: input.options, ...display },
        });
      } else if (isField(input)) {
        response = await askAndRespond({
          context: input.context,
          step: {
            kind: 'field',
            masked: (input.secrecyLevel as string) !== 'PLAIN',
            minLength: input.minLength,
            maxLength: input.maxLength,
            ...display,
          },
        });
      } else {
        const { context, pollingDelaySecs } = input as Confirmation;

        if (pollingDelaySecs === undefined || pollingDelaySecs === null) {
          pollingSince = null;
          await abortable(ask({ kind: 'confirmation', ...display }));
          onPolling({ kind: 'polling' });
        } else {
          pollingSince ??= now();
          if (now() - pollingSince > POLL_LIMIT_MS) throw new YaxiTimeoutError();
          onPolling({ kind: 'polling', redirectUrl, ...display });
          await abortable(wait({ ms: pollingDelaySecs * MS_PER_SECOND }));
        }
        response = await abortable(client.confirmAccounts({ ticket, context }));
      }
    } else {
      throw new Error('Unknown YAXI response');
    }
  }

  return response;
};

type Translate = (key: string) => string;

export const getYaxiErrorMessage = ({
  error,
  t,
  fallbackKey,
}: {
  error: unknown;
  t: Translate;
  fallbackKey: string;
}): string => {
  const { name, code, userMessage, data } = (error ?? {}) as {
    name?: string;
    code?: string;
    userMessage?: string;
    data?: { message?: string };
  };

  if (userMessage) return userMessage;
  if (error instanceof YaxiTimeoutError) return t('pages.integrations.yaxi.errors.pollingTimeout');
  if (name === 'InvalidCredentialsException') return t('pages.integrations.yaxi.errors.invalidCredentials');
  if (name === 'CanceledException') return t('pages.integrations.yaxi.errors.canceledByBank');
  if (name === 'TicketException' && code === 'EXPIRED_KEY') return t('pages.integrations.yaxi.errors.expiredKey');
  if (name === 'TicketException' && code === 'KEY_ENVIRONMENT_MISMATCH') {
    return t('pages.integrations.yaxi.errors.keyEnvironmentMismatch');
  }
  return data?.message || t(fallbackKey);
};
