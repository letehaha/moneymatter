import { afterEach, describe, expect, it } from '@jest/globals';
import { parse as parseUrl } from 'node:url';

import { isPushEndpointAllowed, normalizePushEndpoint } from './endpoint-allowlist';

describe('isPushEndpointAllowed', () => {
  describe('default push services', () => {
    it.each([
      'https://web.push.apple.com/QGxyz',
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ])('allows %s', (endpoint) => {
      expect(isPushEndpointAllowed({ endpoint })).toBe(true);
    });

    it('allows an upper-case host', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://WEB.PUSH.APPLE.COM/x' })).toBe(true);
    });

    it('allows an explicit default port and an upper-case host', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://WEB.PUSH.APPLE.COM:443/x' })).toBe(true);
    });

    it.each([
      ['http:', 'http://web.push.apple.com/x'],
      ['an IPv4 literal', 'https://127.0.0.1/x'],
      ['an IPv4 literal given as an integer', 'https://2130706433/x'],
      ['an IPv6 literal', 'https://[::1]/x'],
      ['credentials in the URL', 'https://user:pass@web.push.apple.com/x'],
      ['a username without a password', 'https://user@web.push.apple.com/x'],
      ['a non-default port', 'https://web.push.apple.com:8443/x'],
      ['a lookalike suffix host', 'https://push.apple.com.evil.test/x'],
      ['a host that is not a subdomain of push.apple.com', 'https://evilpush.apple.com/x'],
      ['the bare wildcard base', 'https://push.apple.com/x'],
      ['localhost', 'https://localhost/x'],
      ['a trailing-dot host', 'https://web.push.apple.com./x'],
      ['a host that only contains an allowed name in the path', 'https://evil.test/web.push.apple.com'],
      ['a malformed URL', 'not a url'],
      ['an empty string', ''],
      [
        'a percent-encoded dot joining an attacker host to an allowed suffix',
        'https://attacker.example%2epush.apple.com/x',
      ],
      ['a percent-encoded dot in upper case', 'https://attacker.example%2Epush.apple.com/x'],
      ['an encoded dot hiding the cloud metadata IP', 'https://169.254.169.254%2epush.apple.com/x'],
      ['an encoded dot hiding localhost', 'https://localhost%2epush.apple.com/x'],
      ['a fully encoded IPv4 literal', 'https://127%2e0%2e0%2e1/x'],
      ['an encoded IPv4 literal digits', 'https://%31%32%37.0.0.1/x'],
      ['an encoded letter of an allowed host', 'https://web.push.%61pple.com/x'],
      ['an encoded IPv6 literal', 'https://%5b::1%5d/x'],
      ['an encoded colon', 'https://web.push.apple.com%3a8443/x'],
      ['an encoded at sign', 'https://evil.test%40web.push.apple.com/x'],
      ['a mixed-case lookalike with an extra label', 'https://Web.Push.Apple.Com.Evil.Test/x'],
      ['an IPv6 literal with an allowed-looking zone', 'https://[::ffff:127.0.0.1]/x'],
      ['a dotted-hex IPv4 literal', 'https://0x7f.0.0.1/x'],
      ['a backslash that legacy parsers read as userinfo', 'https://web.push.apple.com\\@evil.test/x'],
      ['a userinfo that names an allowed host', 'https://web.push.apple.com@evil.test/x'],
      ['a non-http scheme', 'ftp://web.push.apple.com/x'],
    ])('refuses %s', (_label, endpoint) => {
      expect(isPushEndpointAllowed({ endpoint })).toBe(false);
    });
  });

  describe('normalizePushEndpoint', () => {
    it('returns the WHATWG-normalized URL the sender must POST to', () => {
      expect(normalizePushEndpoint({ endpoint: 'https://WEB.PUSH.APPLE.COM:443/QG xyz?a=b' })).toBe(
        'https://web.push.apple.com/QG%20xyz?a=b',
      );
      expect(normalizePushEndpoint({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def' })).toBe(
        'https://fcm.googleapis.com/fcm/send/abc:def',
      );
    });

    it('returns null for a refused endpoint', () => {
      expect(normalizePushEndpoint({ endpoint: 'https://attacker.example%2epush.apple.com/x' })).toBeNull();
      expect(normalizePushEndpoint({ endpoint: 'https://evil.test/x' })).toBeNull();
    });

    it('keeps the host a legacy url.parse() reads equal to the validated one', () => {
      // web-push 3 reads the endpoint with the legacy parser, so check and use must agree on the host.
      for (const endpoint of ['https://web.push.apple.com/x', 'https://WEB.PUSH.APPLE.COM:443/a?b=c#d']) {
        const normalized = normalizePushEndpoint({ endpoint })!;
        expect(parseUrl(normalized).hostname).toBe(new URL(normalized).hostname);
      }
    });
  });

  describe('WEB_PUSH_ALLOWED_HOSTS override', () => {
    const allowedHosts = 'ntfy.example.org,*.push.example.net';

    it('allows the listed exact host and wildcard hosts', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://ntfy.example.org/up/abc', allowedHosts })).toBe(true);
      expect(isPushEndpointAllowed({ endpoint: 'https://eu.push.example.net/abc', allowedHosts })).toBe(true);
    });

    it('replaces the default list', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://web.push.apple.com/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', allowedHosts })).toBe(false);
    });

    it('does not let a wildcard match its own base or a lookalike', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://push.example.net/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://evilpush.example.net/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://ntfy.example.org.evil.test/x', allowedHosts })).toBe(false);
    });

    it('tolerates spaces, empty entries and mixed case in the list', () => {
      expect(
        isPushEndpointAllowed({ endpoint: 'https://ntfy.example.org/x', allowedHosts: ' , NTFY.example.org ,, ' }),
      ).toBe(true);
    });

    it('keeps the transport rules: https, no IP literal, no credentials, default port', () => {
      expect(isPushEndpointAllowed({ endpoint: 'http://ntfy.example.org/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://user:pw@ntfy.example.org/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://ntfy.example.org:8443/x', allowedHosts })).toBe(false);
      expect(isPushEndpointAllowed({ endpoint: 'https://10.0.0.5/x', allowedHosts: '10.0.0.5' })).toBe(false);
    });

    it('falls back to the default list when the override is blank', () => {
      expect(isPushEndpointAllowed({ endpoint: 'https://web.push.apple.com/x', allowedHosts: '  , ' })).toBe(true);
    });
  });

  describe('environment', () => {
    const original = process.env.WEB_PUSH_ALLOWED_HOSTS;

    afterEach(() => {
      if (original === undefined) delete process.env.WEB_PUSH_ALLOWED_HOSTS;
      else process.env.WEB_PUSH_ALLOWED_HOSTS = original;
    });

    it('reads WEB_PUSH_ALLOWED_HOSTS on each call when no override is passed', () => {
      process.env.WEB_PUSH_ALLOWED_HOSTS = 'ntfy.example.org';
      expect(isPushEndpointAllowed({ endpoint: 'https://ntfy.example.org/x' })).toBe(true);
      expect(isPushEndpointAllowed({ endpoint: 'https://web.push.apple.com/x' })).toBe(false);

      delete process.env.WEB_PUSH_ALLOWED_HOSTS;
      expect(isPushEndpointAllowed({ endpoint: 'https://web.push.apple.com/x' })).toBe(true);
    });
  });
});
