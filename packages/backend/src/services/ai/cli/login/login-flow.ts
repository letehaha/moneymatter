export const DEFAULT_LOGIN_TIMEOUTS = {
  /** From spawn until the sign-in URL (and device code) is on screen */
  urlMs: 30 * 1000,
  /** From the pasted code until the token is printed */
  tokenMs: 60 * 1000,
  /** Codex: from the device code until the CLI exits */
  completionMs: 15 * 60 * 1000,
};

export type LoginTimeouts = typeof DEFAULT_LOGIN_TIMEOUTS;

export interface LoginCredential {
  /** The Claude token or the Codex `auth.json` content */
  credential: string;
  credentialExpiresAt?: string;
}

/**
 * One in-flight CLI sign-in. `ready` settles once the user has something to act on, `result` once the
 * CLI produced the credential. Both reject with an `Error` whose message is safe to show the user
 * (redacted, localized). Claude flows take the pasted code through `submitCode`.
 */
export interface LoginFlow {
  ready: Promise<{ authUrl: string; userCode?: string }>;
  result: Promise<LoginCredential>;
  /** Throws `ValidationError` for a code that can't be one; the flow keeps waiting. */
  submitCode?: (params: { code: string }) => void;
  /** Kills the PTY and cleans up; `result` rejects afterwards. */
  cancel: () => void;
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Whoever never awaits it must not crash the process with an unhandled rejection.
  promise.catch(() => {});

  return { promise, resolve, reject };
}
