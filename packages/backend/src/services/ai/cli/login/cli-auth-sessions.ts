import { AI_PROVIDER, AICliProvider, CliAuthSessionInfo, CliAuthSessionStatus } from '@bt/shared/types';
import { decryptToken, encryptToken } from '@common/utils/encryption';
import { t } from '@i18n/index';
import { NotFoundError, TooManyRequests, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { randomUUID } from 'crypto';

import { CliCredentialSource } from '../cli-credential-run';
import { startClaudeSetupTokenFlow } from './claude-setup-token-flow';
import { startCodexDeviceAuthFlow } from './codex-device-auth-flow';
import { LoginFlow, LoginTimeouts } from './login-flow';
import { redactSecrets } from './pty-session';

/** How long a sign-in may take, and again how long a finished one waits for its Save. */
const SESSION_TTL_MS = 15 * 60 * 1000;
/** How long an expired session stays readable (as `expired`) before the sweep drops it. */
const EXPIRED_RETENTION_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_LIVE_FLOWS = 3;

interface CliAuthSession {
  id: string;
  userId: number;
  provider: AICliProvider;
  status: CliAuthSessionStatus;
  authUrl?: string;
  userCode?: string;
  expiresAt: number;
  error?: string;
  /** Present while a PTY may still be running */
  flow?: LoginFlow;
  /** The signed-in credential, encrypted; the revision `sessionCredentialSource` loads against */
  keyEncrypted?: string;
  credentialExpiresAt?: string;
}

/** In memory by design: a single backend process on self-host; a restart drops in-flight sign-ins. */
const sessions = new Map<string, CliAuthSession>();
let sweepTimer: NodeJS.Timeout | undefined;

const LIVE_STATUSES: CliAuthSessionStatus[] = ['starting', 'awaiting-user', 'verifying'];

function toInfo({ session }: { session: CliAuthSession }): CliAuthSessionInfo {
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    authUrl: session.authUrl,
    userCode: session.userCode,
    expiresAt: new Date(session.expiresAt).toISOString(),
    error: session.status === 'failed' ? session.error : undefined,
  };
}

function closeSession({ session }: { session: CliAuthSession }) {
  session.flow?.cancel();
  session.flow = undefined;
}

function removeSession({ session }: { session: CliAuthSession }) {
  closeSession({ session });
  session.keyEncrypted = undefined;
  sessions.delete(session.id);
}

function expireIfDue({ session }: { session: CliAuthSession }) {
  if (session.status === 'expired' || Date.now() < session.expiresAt) return;

  closeSession({ session });
  session.keyEncrypted = undefined;
  session.status = 'expired';
}

/** Expires sessions past their TTL and drops the ones that stayed expired for the retention period. */
export function sweepCliAuthSessions() {
  for (const session of sessions.values()) {
    expireIfDue({ session });

    if (session.status === 'expired' && Date.now() >= session.expiresAt + EXPIRED_RETENTION_MS) {
      sessions.delete(session.id);
    }
  }
}

function ensureSweepTimer() {
  if (sweepTimer) return;

  sweepTimer = setInterval(sweepCliAuthSessions, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

function markFailed({ session, error }: { session: CliAuthSession; error: unknown }) {
  if (sessions.get(session.id) !== session || !LIVE_STATUSES.includes(session.status)) return;

  session.status = 'failed';
  session.error = redactSecrets({ text: error instanceof Error ? error.message : String(error) });
  session.flow = undefined;
}

function findOwned({ userId, sessionId }: { userId: number; sessionId: string }): CliAuthSession | undefined {
  const session = sessions.get(sessionId);

  if (!session || session.userId !== userId) return undefined;

  expireIfDue({ session });

  return session;
}

function getOwnedOrThrow({ userId, sessionId }: { userId: number; sessionId: string }): CliAuthSession {
  const session = findOwned({ userId, sessionId });

  if (!session) throw new NotFoundError({ message: t({ key: 'ai.cliAuthSessionNotFound' }) });

  return session;
}

/** A finished, unconsumed sign-in of this user and provider; anything else is a 422. */
function getUsableSession({
  userId,
  sessionId,
  provider,
}: {
  userId: number;
  sessionId: string;
  provider: AICliProvider;
}): CliAuthSession & { keyEncrypted: string } {
  const session = findOwned({ userId, sessionId });

  if (!session || session.provider !== provider || session.status !== 'succeeded' || !session.keyEncrypted) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNotUsable' }) });
  }

  return session as CliAuthSession & { keyEncrypted: string };
}

/**
 * Starts the CLI login and resolves once the user has something to act on (URL, plus the device code
 * for Codex) or the login already failed. A new start by the same user for the same provider cancels
 * the previous session; at most 3 logins run at once.
 */
export async function startSession({
  userId,
  provider,
  flowTimeouts,
}: {
  userId: number;
  provider: AICliProvider;
  /** Overrides the login step timeouts (tests). */
  flowTimeouts?: LoginTimeouts;
}): Promise<CliAuthSessionInfo> {
  ensureSweepTimer();

  for (const previous of sessions.values()) {
    if (previous.userId === userId && previous.provider === provider) removeSession({ session: previous });
  }

  const liveFlows = [...sessions.values()].filter((existing) => existing.flow).length;

  if (liveFlows >= MAX_LIVE_FLOWS) {
    throw new TooManyRequests({ message: t({ key: 'ai.cliAuthTooManySessions' }) });
  }

  const flow =
    provider === AI_PROVIDER.codex
      ? startCodexDeviceAuthFlow({ timeouts: flowTimeouts })
      : startClaudeSetupTokenFlow({ timeouts: flowTimeouts });

  const session: CliAuthSession = {
    id: randomUUID(),
    userId,
    provider,
    status: 'starting',
    expiresAt: Date.now() + SESSION_TTL_MS,
    flow,
  };

  sessions.set(session.id, session);

  flow.result.then(
    ({ credential, credentialExpiresAt }) => {
      if (sessions.get(session.id) !== session || !LIVE_STATUSES.includes(session.status)) return;

      try {
        session.keyEncrypted = encryptToken(credential);
        session.credentialExpiresAt = credentialExpiresAt;
        session.status = 'succeeded';
        session.flow = undefined;
        // A slow approval must not eat the time the user needs to press Save.
        session.expiresAt = Date.now() + SESSION_TTL_MS;
      } catch (error) {
        markFailed({ session, error });
      }
    },
    (error) => markFailed({ session, error }),
  );

  try {
    const { authUrl, userCode } = await flow.ready;

    if (sessions.get(session.id) === session) {
      session.authUrl = authUrl;
      session.userCode = userCode;
      if (session.status === 'starting') session.status = 'awaiting-user';
    }
  } catch (error) {
    markFailed({ session, error });
  }

  return toInfo({ session });
}

export function getSession({ userId, sessionId }: { userId: number; sessionId: string }): CliAuthSessionInfo {
  return toInfo({ session: getOwnedOrThrow({ userId, sessionId }) });
}

/** Claude only: hands the code the user pasted back to the waiting `setup-token`. */
export function submitCode({
  userId,
  sessionId,
  code,
}: {
  userId: number;
  sessionId: string;
  code: string;
}): CliAuthSessionInfo {
  const session = getOwnedOrThrow({ userId, sessionId });

  if (session.provider !== AI_PROVIDER.claudeCode || session.status !== 'awaiting-user' || !session.flow?.submitCode) {
    throw new ValidationError({ message: t({ key: 'ai.cliAuthSessionNoCodeStep' }) });
  }

  session.flow.submitCode({ code });
  session.status = 'verifying';

  return toInfo({ session });
}

export function cancelSession({ userId, sessionId }: { userId: number; sessionId: string }): void {
  removeSession({ session: getOwnedOrThrow({ userId, sessionId }) });
}

/**
 * Non-consuming read of a succeeded sign-in's encrypted credential, for the Test probe and the
 * pre-save probe. The ciphertext is also the revision `sessionCredentialSource` loads against.
 */
export function peekCredential({
  userId,
  sessionId,
  provider,
}: {
  userId: number;
  sessionId: string;
  provider: AICliProvider;
}): { keyEncrypted: string; credentialExpiresAt?: string } {
  const { keyEncrypted, credentialExpiresAt } = getUsableSession({ userId, sessionId, provider });

  return { keyEncrypted, credentialExpiresAt };
}

/**
 * One-shot: returns the latest encrypted credential (including a refresh a probe saved) and drops
 * the session. Called by create/update only after their probe succeeded.
 */
export function consumeCredential({
  userId,
  sessionId,
  provider,
}: {
  userId: number;
  sessionId: string;
  provider: AICliProvider;
}): { keyEncrypted: string; credentialExpiresAt?: string } {
  const session = getUsableSession({ userId, sessionId, provider });
  const { keyEncrypted, credentialExpiresAt } = session;

  removeSession({ session });

  return { keyEncrypted, credentialExpiresAt };
}

/**
 * Stores a credential the CLI refreshed during a probe, as a compare-and-swap against the
 * ciphertext the probe loaded. A consumed, cancelled or expired session, or one whose credential
 * changed meanwhile, is left alone.
 */
export async function replaceSessionCredential({
  userId,
  sessionId,
  expectedRevision,
  credential,
}: {
  userId: number;
  sessionId: string;
  expectedRevision: string;
  credential: string;
}): Promise<boolean> {
  const session = findOwned({ userId, sessionId });

  if (!session || session.status !== 'succeeded' || session.keyEncrypted !== expectedRevision) {
    logger.warn('Skipped saving a refreshed CLI credential: the sign-in session changed or is gone', { sessionId });

    return false;
  }

  session.keyEncrypted = encryptToken(credential);

  return true;
}

/** The probe's view of a sign-in session; the decrypted credential exists only inside `load`. */
export function sessionCredentialSource({
  userId,
  sessionId,
  provider,
}: {
  userId: number;
  sessionId: string;
  provider: AICliProvider;
}): CliCredentialSource {
  return {
    connectionKey: `session:${sessionId}`,
    load: async () => {
      const { keyEncrypted } = peekCredential({ userId, sessionId, provider });

      return { credential: decryptToken(keyEncrypted), revision: keyEncrypted };
    },
    save: async ({ credential, loadedRevision }) => {
      const swapped = await replaceSessionCredential({
        userId,
        sessionId,
        expectedRevision: loadedRevision,
        credential,
      });

      return swapped ? { revision: peekCredential({ userId, sessionId, provider }).keyEncrypted } : null;
    },
  };
}

/** Cancels every session and stops the sweep (graceful shutdown, tests). */
export function resetCliAuthSessions(): void {
  for (const session of sessions.values()) removeSession({ session });

  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = undefined;
}
