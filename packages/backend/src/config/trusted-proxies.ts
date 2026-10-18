import { isIP } from 'node:net';

export const TRUSTED_PROXIES_ENV = 'TRUSTED_PROXIES';

/**
 * Express's named ranges: 127/8 and ::1, 169.254/16 and fe80::/10, and the private ranges
 * 10/8, 172.16/12, 192.168/16 and fc00::/7. Matches the usual reverse-proxy setups, where the proxy
 * sits on the same host or on the same Docker network as the backend.
 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ['loopback', 'linklocal', 'uniquelocal'];

const KEYWORDS: ReadonlySet<string> = new Set(DEFAULT_TRUSTED_PROXIES);
const NONE = 'none';
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
 * Reads the proxy addresses whose `X-Forwarded-For` header the backend believes. Used for Express's
 * `trust proxy`, which decides `req.ip` and the client address recorded on auth sessions.
 *
 * `raw` is a comma-separated list of the Express keywords (`loopback`, `linklocal`, `uniquelocal`),
 * IP addresses and CIDR ranges. Unset or blank gives the private ranges; `none` trusts no proxy.
 * A hop count is refused on purpose: it trusts whatever address the nth hop claims, so a client that
 * reaches the backend directly could pick its own address. A bad entry throws, so a typo fails the
 * start instead of silently trusting the wrong hosts.
 */
export function resolveTrustedProxies({ raw }: { raw: string | undefined }): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) return [...DEFAULT_TRUSTED_PROXIES];

  const lowered = entries.map((entry) => entry.toLowerCase());
  if (lowered.includes(NONE)) {
    if (entries.length > 1) {
      throw new Error(`${TRUSTED_PROXIES_ENV}: "${NONE}" cannot be combined with other entries (got "${raw}").`);
    }
    return [];
  }

  entries.forEach((entry, index) => {
    if (!isValidEntry({ entry: lowered[index]! })) {
      throw new Error(
        `${TRUSTED_PROXIES_ENV}: invalid entry "${entry}". Use loopback, linklocal, uniquelocal, an IP address or a CIDR range, separated by commas.`,
      );
    }
  });

  return lowered;
}
