import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import DeviceTokens from '@models/device-tokens.model';
import * as helpers from '@tests/helpers';

const BUNDLE_ID = 'app.moneymatter.mobile';
const TOKEN = 'ab'.repeat(32);

const payload = (overrides: Record<string, unknown> = {}) => ({
  token: TOKEN,
  environment: 'production',
  bundleId: BUNDLE_ID,
  ...overrides,
});

describe('Device tokens', () => {
  const originalBundleId = process.env.APPLE_APP_BUNDLE_IDENTIFIER;
  beforeEach(() => {
    process.env.APPLE_APP_BUNDLE_IDENTIFIER = BUNDLE_ID;
  });
  afterEach(() => {
    if (originalBundleId === undefined) delete process.env.APPLE_APP_BUNDLE_IDENTIFIER;
    else process.env.APPLE_APP_BUNDLE_IDENTIFIER = originalBundleId;
  });

  it('unregisters an unknown token without error', async () => {
    expect((await helpers.unregisterDeviceToken({ token: TOKEN })).statusCode).toBe(200);
  });

  it('registers a token once, updating it on a repeat registration', async () => {
    expect((await helpers.registerDeviceToken({ payload: payload() })).statusCode).toBe(200);
    expect(
      (await helpers.registerDeviceToken({ payload: payload({ token: TOKEN.toUpperCase(), environment: 'sandbox' }) }))
        .statusCode,
    ).toBe(200);

    const rows = await DeviceTokens.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: TOKEN, environment: 'sandbox', bundleId: BUNDLE_ID });
  });

  it('moves a token registered by another user to the new user', async () => {
    const other = await helpers.signUpSecondUser();
    await helpers.asUser({ cookies: other.cookies, fn: () => helpers.registerDeviceToken({ payload: payload() }) });
    const [before] = await DeviceTokens.findAll();

    await helpers.registerDeviceToken({ payload: payload(), raw: true });

    const rows = await DeviceTokens.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).not.toBe(before!.userId);
  });

  it('rejects a bundle id other than the app, an unknown environment and a non-hex token', async () => {
    const wrongBundle = await helpers.registerDeviceToken({ payload: payload({ bundleId: 'com.attacker.app' }) });
    expect(wrongBundle.statusCode).toBe(ERROR_CODES.ValidationError);

    const badEnvironment = await helpers.registerDeviceToken({ payload: payload({ environment: 'staging' }) });
    expect(badEnvironment.statusCode).toBe(ERROR_CODES.ValidationError);

    const badToken = await helpers.registerDeviceToken({ payload: payload({ token: '../../3/device/x' }) });
    expect(badToken.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.unregisterDeviceToken({ token: 'zz'.repeat(32) })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );

    delete process.env.APPLE_APP_BUNDLE_IDENTIFIER;
    const unconfigured = await helpers.registerDeviceToken({ payload: payload() });
    expect(unconfigured.statusCode).toBe(ERROR_CODES.ValidationError);

    expect(await DeviceTokens.count()).toBe(0);
  });

  it('unregisters only the caller’s own token, idempotently', async () => {
    const other = await helpers.signUpSecondUser();
    const otherToken = 'cd'.repeat(32);
    await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.registerDeviceToken({ payload: payload({ token: otherToken }) }),
    });
    await helpers.registerDeviceToken({ payload: payload(), raw: true });

    expect((await helpers.unregisterDeviceToken({ token: otherToken })).statusCode).toBe(200);
    expect((await helpers.unregisterDeviceToken({ token: TOKEN })).statusCode).toBe(200);
    expect((await helpers.unregisterDeviceToken({ token: TOKEN })).statusCode).toBe(200);

    expect((await DeviceTokens.findAll()).map((row) => row.token)).toEqual([otherToken]);
  });
});
