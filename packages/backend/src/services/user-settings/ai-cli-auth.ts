import { AICliProvider, CliAiAvailability, CliAuthSessionInfo, AI_CLI_PROVIDERS } from '@bt/shared/types';
import { getCliAiAccess } from '@services/ai/cli/cli-access';
import { getCliVersion } from '@services/ai/cli/cli-binaries';
import { cancelSession, getSession, startSession, submitCode } from '@services/ai/cli/login/cli-auth-sessions';

/**
 * Why subscription providers are or are not usable for this user, plus which CLIs the backend can
 * run. Binaries are probed only for users who pass the access gate.
 */
export async function getCliAvailability({ userId }: { userId: number }): Promise<CliAiAvailability> {
  const access = await getCliAiAccess({ userId });

  if (!access.allowed) return { available: false, reason: access.reason, providers: [] };

  const providers = await Promise.all(
    AI_CLI_PROVIDERS.map(async (provider) => {
      const version = await getCliVersion({ provider });

      return { provider, installed: version !== null, version };
    }),
  );

  return { available: true, providers };
}

export const startCliAuthSession = ({
  userId,
  provider,
}: {
  userId: number;
  provider: AICliProvider;
}): Promise<CliAuthSessionInfo> => startSession({ userId, provider });

export const getCliAuthSession = ({ userId, sessionId }: { userId: number; sessionId: string }): CliAuthSessionInfo =>
  getSession({ userId, sessionId });

export const submitCliAuthCode = ({
  userId,
  sessionId,
  code,
}: {
  userId: number;
  sessionId: string;
  code: string;
}): CliAuthSessionInfo => submitCode({ userId, sessionId, code });

export const cancelCliAuthSession = ({ userId, sessionId }: { userId: number; sessionId: string }): void =>
  cancelSession({ userId, sessionId });
