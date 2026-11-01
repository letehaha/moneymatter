import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { logger } from '@js/utils/logger';
import { createPrivateKey, sign } from 'node:crypto';

// Apple rejects client secrets that live longer than 6 months.
const MAX_LIFETIME_SECONDS = 15_777_000;

const APPLE_ENV_VARS = [
  EnvVar.APPLE_CLIENT_ID,
  EnvVar.APPLE_TEAM_ID,
  EnvVar.APPLE_KEY_ID,
  EnvVar.APPLE_PRIVATE_KEY,
] as const;

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/**
 * Signs the ES256 JWT that Apple accepts as the OAuth client secret.
 * https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 */
export const createAppleClientSecret = ({
  clientId,
  teamId,
  keyId,
  privateKey,
  now = new Date(),
}: {
  clientId: string;
  teamId: string;
  keyId: string;
  /** Contents of the .p8 file; `\n` escapes are accepted so it fits on one env line. */
  privateKey: string;
  now?: Date;
}): string => {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = base64url(
    JSON.stringify({
      iss: teamId,
      iat,
      exp: iat + MAX_LIFETIME_SECONDS,
      aud: 'https://appleid.apple.com',
      sub: clientId,
    }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(privateKey.replace(/\\n/g, '\n')),
    dsaEncoding: 'ieee-p1363',
  });

  return `${header}.${payload}.${base64url(signature)}`;
};

/**
 * Null when Apple sign-in is unconfigured, partially configured or has an unusable key,
 * so a bad optional setting disables Apple instead of crashing boot.
 */
export const getAppleClientSecretFromEnv = (): string | null => {
  const values = APPLE_ENV_VARS.map((name) => process.env[name]);
  const missing = APPLE_ENV_VARS.filter((name, index) => !isEnvConfigured(name, values[index]));

  if (missing.length === APPLE_ENV_VARS.length) return null;
  if (missing.length) {
    logger.warn(`[auth] Sign in with Apple disabled, missing: ${missing.join(', ')}`);
    return null;
  }

  const [clientId, teamId, keyId, privateKey] = values as [string, string, string, string];
  try {
    return createAppleClientSecret({ clientId, teamId, keyId, privateKey });
  } catch (error) {
    logger.error({
      message: '[auth] Sign in with Apple disabled: APPLE_PRIVATE_KEY is not a valid ES256 .p8 key',
      error: error as Error,
    });
    return null;
  }
};
