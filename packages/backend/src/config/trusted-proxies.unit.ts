import { describe, expect, it } from '@jest/globals';

import { DEFAULT_TRUSTED_PROXIES, resolveTrustedProxies } from './trusted-proxies';

describe('resolveTrustedProxies', () => {
  it('falls back to the private ranges when the variable is unset, empty or blank', () => {
    expect(resolveTrustedProxies({ raw: undefined })).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect(resolveTrustedProxies({ raw: '' })).toEqual(DEFAULT_TRUSTED_PROXIES);
    expect(resolveTrustedProxies({ raw: '  , ' })).toEqual(DEFAULT_TRUSTED_PROXIES);
  });

  it('splits a comma-separated list and trims every entry', () => {
    expect(resolveTrustedProxies({ raw: ' 10.0.0.0/8 ,172.19.0.0/16,loopback ' })).toEqual([
      '10.0.0.0/8',
      '172.19.0.0/16',
      'loopback',
    ]);
  });

  it('accepts a single IPv6 address or range', () => {
    expect(resolveTrustedProxies({ raw: 'fd00::/8' })).toEqual(['fd00::/8']);
    expect(resolveTrustedProxies({ raw: '2001:db8::1' })).toEqual(['2001:db8::1']);
  });

  it('rejects an entry that is neither a keyword, an IP address nor a CIDR range', () => {
    expect(() => resolveTrustedProxies({ raw: 'loopback,not-an-ip' })).toThrow(/TRUSTED_PROXIES.*not-an-ip/);
    expect(() => resolveTrustedProxies({ raw: '10.0.0.0/33' })).toThrow(/10\.0\.0\.0\/33/);
    expect(() => resolveTrustedProxies({ raw: '10.0.0.0/abc' })).toThrow(/10\.0\.0\.0\/abc/);
  });

  it('rejects a hop count, which would let a direct client pick its own address', () => {
    expect(() => resolveTrustedProxies({ raw: '1' })).toThrow(/TRUSTED_PROXIES.*"1"/);
  });

  it('lowercases keywords, which Express matches case-sensitively', () => {
    expect(resolveTrustedProxies({ raw: 'LoopBack' })).toEqual(['loopback']);
  });
});
