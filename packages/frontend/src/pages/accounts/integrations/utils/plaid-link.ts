const PLAID_LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

interface PlaidLinkHandler {
  open: () => void;
  destroy: () => void;
}

interface PlaidLinkSdk {
  create(options: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string | null) => void;
    onExit: (error: unknown) => void;
  }): PlaidLinkHandler;
}

type LinkOutcome = { status: 'success'; publicToken: string | null } | { status: 'cancelled' };

let sdkPromise: Promise<PlaidLinkSdk> | undefined;

const loadPlaidLink = () => {
  sdkPromise ??= new Promise<PlaidLinkSdk>((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (sdk?: PlaidLinkSdk) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (sdk && typeof sdk.create === 'function') {
        resolve(sdk);
      } else {
        script.remove();
        reject(new Error('Plaid Link could not load'));
      }
    };
    const timeout = window.setTimeout(() => finish(), SCRIPT_LOAD_TIMEOUT_MS);
    script.src = PLAID_LINK_SCRIPT;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => finish((window as Window & { Plaid?: PlaidLinkSdk }).Plaid);
    script.onerror = () => finish();
    document.head.append(script);
  }).catch((error: unknown) => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
};

export const openPlaidLink = async ({
  linkToken,
  receivedRedirectUri,
  signal,
  beforeOpen,
}: {
  linkToken: string;
  receivedRedirectUri?: string;
  signal: AbortSignal;
  beforeOpen: () => Promise<void>;
}): Promise<LinkOutcome> => {
  const sdk = await loadPlaidLink();
  signal.throwIfAborted();
  await beforeOpen();
  signal.throwIfAborted();

  let handler: PlaidLinkHandler | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await new Promise<LinkOutcome>((resolve, reject) => {
      let settled = false;
      cancel = () => {
        settled = true;
        resolve({ status: 'cancelled' });
      };
      signal.addEventListener('abort', cancel, { once: true });
      handler = sdk.create({
        token: linkToken,
        receivedRedirectUri,
        onSuccess: (publicToken) => {
          settled = true;
          resolve({ status: 'success', publicToken });
        },
        onExit: (error) => {
          settled = true;
          if (error) reject(new Error('Plaid Link did not complete'));
          else cancel?.();
        },
      });
      if (!settled) handler.open();
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    handler?.destroy();
  }
};
