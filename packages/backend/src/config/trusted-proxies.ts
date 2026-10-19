import { isIP } from 'node:net';

export const TRUSTED_PROXIES_ENV = 'TRUSTED_PROXIES';

/**
 * Express's named ranges: 127/8 and ::1, 169.254/16 and fe80::/10, and the private ranges
 * 10/8, 172.16/12, 192.168/16 and fc00::/7. Matches the usual reverse-proxy setups, where the proxy
 * sits on the same host or on the same Docker network as the backend.
 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'linklocal', 'uniquelocal'];

const KEYWORDS: ReadonlySet<string> = new Set(DEFAULT_TRUSTED_PROXIES);
const PREFIX_PATTERN = /^\d{1,3}$/;

function isValidEntry({ entry }: { entry: string }): boolean {
  if (KEYWORDS.has(entry)) return true;

  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (!family) return false;
  if (slash === -1) return true;

  const prefix = entry.slice(slash + 1);
  return PREFIX_PATTERN.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses `TRUSTED_PROXIES` for Express's `trust proxy`. A hop count is refused: it trusts whatever the
 * nth hop claims, so a client reaching the backend directly could pick its own address.
 */
export function resolveTrustedProxies({ raw }: { raw: string | undefined }): readonly string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (entries.length === 0) return DEFAULT_TRUSTED_PROXIES;

  const invalid = entries.find((entry) => !isValidEntry({ entry }));
  if (invalid !== undefined) {
    throw new Error(
      `${TRUSTED_PROXIES_ENV}: invalid entry "${invalid}". Use loopback, linklocal, uniquelocal, an IP address or a CIDR range, separated by commas.`,
    );
  }

  return entries;
}
