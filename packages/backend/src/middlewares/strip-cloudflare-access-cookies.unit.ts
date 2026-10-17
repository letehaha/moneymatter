import { describe, expect, it } from '@jest/globals';

import { stripCloudflareAccessCookies } from './strip-cloudflare-access-cookies';

describe('stripCloudflareAccessCookies', () => {
  it('returns undefined when the header holds only Cloudflare Access cookies', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization=abc.def.ghi' })).toBeUndefined();
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization=abc; CF_AppSession=xyz' })).toBeUndefined();
  });

  it('keeps the app session cookie and drops the Cloudflare ones', () => {
    expect(
      stripCloudflareAccessCookies({
        cookieHeader: 'bt_auth.session_token=s3cret; CF_Authorization=abc; theme=dark; CF_AppSession=xyz',
      }),
    ).toBe('bt_auth.session_token=s3cret; theme=dark');
  });

  it('leaves a header without Cloudflare cookies equivalent', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'bt_auth.session_token=s3cret' })).toBe(
      'bt_auth.session_token=s3cret',
    );
  });

  it('does not match cookie names that merely start with a Cloudflare name', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization_other=1; xCF_Authorization=2' })).toBe(
      'CF_Authorization_other=1; xCF_Authorization=2',
    );
  });

  it('returns undefined for an empty or missing header', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: '' })).toBeUndefined();
    expect(stripCloudflareAccessCookies({ cookieHeader: undefined })).toBeUndefined();
  });

  it('handles malformed input without throwing', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: ' ; ;; ' })).toBeUndefined();
    expect(stripCloudflareAccessCookies({ cookieHeader: 123 })).toBeUndefined();
    expect(stripCloudflareAccessCookies({ cookieHeader: ['CF_Authorization=a'] })).toBeUndefined();
    expect(stripCloudflareAccessCookies({ cookieHeader: 'garbage; CF_Authorization; =x; keep=1' })).toBe(
      'garbage; =x; keep=1',
    );
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization=a=b=c; keep=1' })).toBe('keep=1');
  });
});
