import { describe, expect, it } from '@jest/globals';

import { stripCloudflareAccessCookies } from './strip-cloudflare-access-cookies';

describe('stripCloudflareAccessCookies', () => {
  it('returns undefined when the header holds only Cloudflare Access cookies', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization=abc; CF_AppSession=xyz' })).toBeUndefined();
  });

  it('keeps every other cookie and drops the Cloudflare ones', () => {
    expect(
      stripCloudflareAccessCookies({
        cookieHeader: 'bt_auth.session_token=s3cret; CF_Authorization=a=b=c; theme=dark; CF_AppSession=xyz',
      }),
    ).toBe('bt_auth.session_token=s3cret; theme=dark');
  });

  it('returns a header without Cloudflare cookies byte-for-byte', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'a=1;b=2' })).toBe('a=1;b=2');
  });

  it('does not match cookie names that merely contain a Cloudflare name', () => {
    expect(stripCloudflareAccessCookies({ cookieHeader: 'CF_Authorization_other=1; xCF_Authorization=2' })).toBe(
      'CF_Authorization_other=1; xCF_Authorization=2',
    );
  });
});
