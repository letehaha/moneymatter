import { EnvVar } from '@common/utils/env';
import { isIP } from 'node:net';

// Push services whose endpoints browsers hand out: Safari/WebKit, Chrome/Edge (FCM), Firefox and
// the Windows Notification Service. A `*.` entry matches subdomains only, never its own base.
const DEFAULT_ALLOWED_HOSTS = [
  '*.push.apple.com',
  'fcm.googleapis.com',
  '*.push.services.mozilla.com',
  '*.notify.windows.com',
];

const parseAllowedHosts = ({ allowedHosts }: { allowedHosts: string | undefined }): string[] => {
  const entries = (allowedHosts ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return entries.length > 0 ? entries : DEFAULT_ALLOWED_HOSTS;
};

const hostMatches = ({ host, pattern }: { host: string; pattern: string }): boolean =>
  pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;

const RAW_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i;

/**
 * Validates a push endpoint a client registered and returns the URL to POST to, or `null` when it
 * is refused. The backend sends to whatever URL it is given, so the endpoint has to be an `https:`
 * URL on the default port with no credentials, a hostname (never an IP literal) and a host of a
 * known push service. `allowedHosts` (comma-separated, `*.` wildcards) replaces the push service
 * list and defaults to `WEB_PUSH_ALLOWED_HOSTS`, read on each call.
 *
 * The check runs on the WHATWG-parsed URL, but `web-push` reads its endpoint with the legacy
 * `url.parse()`, which disagrees with WHATWG on a percent-encoded host (`a%2epush.apple.com` is
 * `a.push.apple.com` to one and `a` to the other). So an endpoint whose raw authority contains `%`
 * or a backslash is refused, and the caller must send to the returned normalized `href`, never to the
 * raw string: what was checked is then exactly what is requested.
 */
export const normalizePushEndpoint = ({
  endpoint,
  allowedHosts = process.env[EnvVar.WEB_PUSH_ALLOWED_HOSTS],
}: {
  endpoint: string;
  allowedHosts?: string;
}): string | null => {
  const rawAuthority = RAW_AUTHORITY_PATTERN.exec(endpoint)?.[1];
  if (rawAuthority === undefined || rawAuthority.includes('%') || endpoint.includes('\\')) return null;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // `URL` drops the default port, so any remaining port is a non-default one.
  if (url.port) return null;

  // IPv6 hostnames keep their brackets, which `isIP` does not accept.
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith('[')) return null;

  return parseAllowedHosts({ allowedHosts }).some((pattern) => hostMatches({ host, pattern })) ? url.href : null;
};

export const isPushEndpointAllowed = (params: { endpoint: string; allowedHosts?: string }): boolean =>
  normalizePushEndpoint(params) !== null;
