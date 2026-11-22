import { isSelfHost } from '@config/is-self-host';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import ipaddr from 'ipaddr.js';
import { promises as dnsPromises } from 'node:dns';
import net from 'node:net';

/**
 * Outbound-request guard for user-supplied URLs (the custom AI endpoint). On the cloud
 * instance such a URL must never reach the internal network, cloud metadata services or
 * loopback. Self-host operators own their network, so the checks are a no-op there.
 */

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

// Local development points at LLMs on the developer's own machine. Tests run with
// NODE_ENV=test, so the guard stays on there.
export function isGuardBypassed(): boolean {
  return isSelfHost() || process.env.NODE_ENV === 'development';
}

export function isPublicIpAddress({ ip }: { ip: string }): boolean {
  // net.isIP takes canonical literals only, so inet_aton shorthand like "127.1" is rejected, not decoded.
  if (net.isIP(ip) === 0) return false;
  if (!ipaddr.isValid(ip)) return false;

  // process() unwraps an IPv4-mapped ::ffff:x.x.x.x so it is judged by IPv4 rules.
  const address = ipaddr.process(ip);

  return address.range() === 'unicast';
}

/** DNS codes that mean the name does not exist, so the user can fix the typo. */
const UNKNOWN_HOSTNAME_DNS_CODES = new Set(['ENOTFOUND', 'ENODATA']);

/** Throws ValidationError unless the URL can only reach a public internet host. */
export async function assertSafeOutboundUrl({ url }: { url: string }): Promise<void> {
  if (isGuardBypassed()) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError({ message: t({ key: 'urlGuard.invalidUrl' }) });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError({ message: t({ key: 'urlGuard.unsupportedProtocol' }) });
  }

  if (parsed.username || parsed.password) {
    throw new ValidationError({ message: t({ key: 'urlGuard.credentialsInUrlNotAllowed' }) });
  }

  // URL.hostname keeps the brackets around an IPv6 literal
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');

  if (net.isIP(hostname) !== 0) {
    if (!isPublicIpAddress({ ip: hostname })) {
      throw new ValidationError({
        message: t({ key: 'urlGuard.privateAddressBlocked', variables: { host: hostname } }),
      });
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    // Any other code is our resolver failing (EAI_AGAIN, ESERVFAIL, ETIMEDOUT), so we
    // could not check the address and the user is told to retry.
    if (!code || !UNKNOWN_HOSTNAME_DNS_CODES.has(code)) {
      logger.error(
        { message: 'Outbound URL guard could not resolve a hostname', error: error as Error },
        { hostname, code },
      );

      throw new ValidationError({
        message: t({ key: 'urlGuard.hostnameLookupUnavailable', variables: { host: hostname } }),
      });
    }

    throw new ValidationError({ message: t({ key: 'urlGuard.hostnameNotResolvable', variables: { host: hostname } }) });
  }

  if (addresses.length === 0) {
    throw new ValidationError({ message: t({ key: 'urlGuard.hostnameNotResolvable', variables: { host: hostname } }) });
  }

  for (const { address } of addresses) {
    if (!isPublicIpAddress({ ip: address })) {
      throw new ValidationError({
        message: t({ key: 'urlGuard.privateAddressBlocked', variables: { host: hostname } }),
      });
    }
  }
}

/**
 * Re-checks the target on every request and refuses redirects, so a 302 cannot bounce into
 * the internal network. DNS rebinding still gets through: the socket layer resolves the
 * name again after this check.
 */
export function createGuardedFetch(): typeof globalThis.fetch {
  if (isGuardBypassed()) return globalThis.fetch;

  return async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    await assertSafeOutboundUrl({ url });

    const response = await globalThis.fetch(input, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      throw new ValidationError({ message: t({ key: 'urlGuard.redirectNotAllowed' }) });
    }

    return response;
  };
}
