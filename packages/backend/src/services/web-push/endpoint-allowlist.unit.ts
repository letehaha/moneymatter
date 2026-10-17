import { afterEach, describe, expect, it } from '@jest/globals';

import { isPushEndpointAllowed } from './endpoint-allowlist';

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
      ['a non-http scheme', 'ftp://web.push.apple.com/x'],
    ])('refuses %s', (_label, endpoint) => {
      expect(isPushEndpointAllowed({ endpoint })).toBe(false);
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
