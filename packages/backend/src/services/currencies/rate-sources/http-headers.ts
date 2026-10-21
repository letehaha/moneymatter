import { decryptToken, encryptToken } from '@common/utils/encryption';

import { httpHeadersSchema } from './index';

/** The request headers of an HTTP source as the one string saved in "rateSourceHeadersEncrypted". */
export const encryptHttpHeaders = ({ headers }: { headers: Record<string, string> }): string | null =>
  Object.keys(headers).length ? encryptToken(JSON.stringify(headers)) : null;

/**
 * The headers saved on a currency. `null` means the saved blob cannot be read (the instance's
 * secret changed, or the value was tampered with); a currency that sends no headers is `{}`.
 */
export const decryptHttpHeaders = ({ encrypted }: { encrypted: string | null }): Record<string, string> | null => {
  if (!encrypted) return {};

  try {
    const parsed = httpHeadersSchema.safeParse(JSON.parse(decryptToken(encrypted)));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
