import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { logger } from '@js/utils/logger';
import { createECDH, createHash } from 'node:crypto';

export interface WebPushConfig {
  /** base64url, uncompressed P-256 point */
  publicKey: string;
  /** base64url, 32 bytes */
  privateKey: string;
  /** `mailto:` or `https:` URL sent as the VAPID `sub` claim */
  subject: string;
  /** First 16 hex characters of SHA-256 over the public key; changes when the key pair does */
  keyId: string;
}

const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const KEY_ID_LENGTH = 16;
const VAPID_VARS = [EnvVar.VAPID_PUBLIC_KEY, EnvVar.VAPID_PRIVATE_KEY, EnvVar.VAPID_SUBJECT] as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

// `getWebPushConfig` runs on every enqueue, so each (variable, reason) is logged once per process.
const warnedReasons = new Set<string>();

// Messages name the variable and the reason only. A value, its length or any part of it would
// leak key material into the logs.
const warnInvalid = ({ name, reason }: { name: EnvVar; reason: string }): void => {
  const key = `${name}:${reason}`;
  if (warnedReasons.has(key)) return;
  warnedReasons.add(key);
  logger.warn(`[Web Push] ${name} ${reason}. Web Push is disabled.`);
};

const decodeBase64Url = ({ value }: { value: string }): Buffer | null =>
  BASE64URL_PATTERN.test(value) ? Buffer.from(value, 'base64url') : null;

// Apple's push service answers 403 `BadJwtToken` for a `sub` on localhost or a `.local` host.
const isLocalHost = ({ host }: { host: string }): boolean => {
  const lower = host.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local');
};

const validateSubject = ({ subject }: { subject: string }): string | null => {
  let host: string;

  if (subject.startsWith('mailto:')) {
    const address = subject.slice('mailto:'.length).split('?')[0]!;
    const at = address.lastIndexOf('@');
    host = address.slice(at + 1);
    if (at < 1 || !host || /\s/.test(address)) return 'must be a mailto: address or an https: URL';
  } else if (subject.startsWith('https://')) {
    try {
      host = new URL(subject).hostname;
    } catch {
      return 'must be a mailto: address or an https: URL';
    }
  } else {
    return 'must be a mailto: address or an https: URL';
  }

  return isLocalHost({ host }) ? 'must not point at localhost or a .local host' : null;
};

interface KeyPairError {
  name: EnvVar;
  reason: string;
}

const validateKeyPair = ({ publicKey, privateKey }: { publicKey: string; privateKey: string }): KeyPairError | null => {
  const publicBytes = decodeBase64Url({ value: publicKey });
  if (!publicBytes || publicBytes.length !== PUBLIC_KEY_BYTES) {
    return { name: EnvVar.VAPID_PUBLIC_KEY, reason: `must decode to ${PUBLIC_KEY_BYTES} bytes` };
  }
  if (publicBytes[0] !== UNCOMPRESSED_POINT_PREFIX) {
    return { name: EnvVar.VAPID_PUBLIC_KEY, reason: 'must be an uncompressed P-256 point' };
  }

  const privateBytes = decodeBase64Url({ value: privateKey });
  if (!privateBytes || privateBytes.length !== PRIVATE_KEY_BYTES) {
    return { name: EnvVar.VAPID_PRIVATE_KEY, reason: `must decode to ${PRIVATE_KEY_BYTES} bytes` };
  }

  // A private key that is not a valid P-256 scalar throws here.
  const ecdh = createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(privateBytes);
  } catch {
    return { name: EnvVar.VAPID_PRIVATE_KEY, reason: 'must be a valid P-256 private key' };
  }

  // A pair that does not match makes the push service reject every request with 403.
  if (!ecdh.getPublicKey().equals(publicBytes)) {
    return { name: EnvVar.VAPID_PRIVATE_KEY, reason: `must belong to ${EnvVar.VAPID_PUBLIC_KEY}` };
  }

  return null;
};

/**
 * The instance's VAPID configuration, or `null` when Web Push is off: a variable unset, empty,
 * a `.env.template` placeholder, or a value that fails validation. Reads `process.env` on each
 * call.
 */
export const getWebPushConfig = (): WebPushConfig | null => {
  const values = VAPID_VARS.map((name) => process.env[name]);

  if (values.every((value) => !value)) return null;

  const configured = VAPID_VARS.map((name, index) => isEnvConfigured(name, values[index]));
  if (!configured.every(Boolean)) {
    VAPID_VARS.forEach((name, index) => {
      if (!values[index]) warnInvalid({ name, reason: 'is not set' });
    });
    return null;
  }

  const [publicKey, privateKey, subject] = values as [string, string, string];

  const keyError = validateKeyPair({ publicKey, privateKey });
  if (keyError) {
    warnInvalid(keyError);
    return null;
  }

  const subjectError = validateSubject({ subject });
  if (subjectError) {
    warnInvalid({ name: EnvVar.VAPID_SUBJECT, reason: subjectError });
    return null;
  }

  const keyId = createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex').slice(0, KEY_ID_LENGTH);

  return { publicKey, privateKey, subject, keyId };
};
