import { authPool } from '@config/auth';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { makeAuthRequest } from '@tests/helpers/common';

const setPasswordRequest = ({ newPassword, headers }: { newPassword: string; headers?: Record<string, string> }) =>
  makeAuthRequest({ method: 'post', url: '/auth/set-password', payload: { newPassword }, headers });

/** Simulate an OAuth/passkey-only user by removing the credential account created by
 *  email+password signup. Direct auth-schema fixture surgery — there is no HTTP path
 *  that produces a session without a credential account in the e2e environment. */
async function removeCredentialAccount({ email }: { email: string }) {
  const baUser = await authPool.query<{ id: string }>('SELECT id FROM ba_user WHERE email = $1', [email]);
  const baUserId = baUser.rows[0]?.id;
  if (!baUserId) throw new Error(`No ba_user for ${email}`);
  await authPool.query(`DELETE FROM ba_account WHERE "userId" = $1 AND "providerId" = 'credential'`, [baUserId]);
}

describe('POST /auth/set-password', () => {
  it('sets a password for a user without a credential account', async () => {
    const user = await helpers.signUpSecondUser();
    await removeCredentialAccount({ email: user.email });

    const res = await helpers.asUser({
      cookies: user.cookies,
      fn: () => setPasswordRequest({ newPassword: 'brand-new-password-1' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.response.status).toBe(true);
  });

  it('returns 400 with a readable error when a password is already set', async () => {
    const res = await setPasswordRequest({ newPassword: 'another-valid-password-1' });

    expect(res.statusCode).toBe(400);
    expect(res.body.response.code).toBe('PASSWORD_ALREADY_SET');
    expect(res.body.response.message).toBe(t({ key: 'auth.errors.passwordAlreadySet', locale: 'en' }));
  });

  it('translates the error message into the requested locale', async () => {
    const res = await setPasswordRequest({
      newPassword: 'another-valid-password-1',
      headers: { 'Accept-Language': 'uk' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.response.code).toBe('PASSWORD_ALREADY_SET');
    expect(res.body.response.message).toBe(t({ key: 'auth.errors.passwordAlreadySet', locale: 'uk' }));
    expect(res.body.response.message).not.toBe(t({ key: 'auth.errors.passwordAlreadySet', locale: 'en' }));
  });

  it('returns 401 without a session', async () => {
    const res = await helpers.withoutSession(() => setPasswordRequest({ newPassword: 'valid-password-123' }));
    expect(res.statusCode).toBe(401);
  });
});
