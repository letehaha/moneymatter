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

/**
 * Whether the backend may POST to a push endpoint a client registered. The backend sends to
 * whatever URL it is given, so the endpoint has to be an `https:` URL on the default port with no
 * credentials, a hostname (never an IP literal) and a host of a known push service.
 * `allowedHosts` (comma-separated, `*.` wildcards) replaces the push service list and defaults to
 * `WEB_PUSH_ALLOWED_HOSTS`, read on each call.
 */
export const isPushEndpointAllowed = ({
  endpoint,
  allowedHosts = process.env[EnvVar.WEB_PUSH_ALLOWED_HOSTS],
}: {
  endpoint: string;
  allowedHosts?: string;
}): boolean => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  // `URL` drops the default port, so any remaining port is a non-default one.
  if (url.port) return false;

  // IPv6 hostnames keep their brackets, which `isIP` does not accept.
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith('[')) return false;

  return parseAllowedHosts({ allowedHosts }).some((pattern) => hostMatches({ host, pattern }));
};
