import { API_ERROR_CODES } from '@bt/shared/types';
import { IOS_APP_ORIGIN } from '@common/const/ios-app-origin';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const MIN_BUILD = '2611011200';

const iosHeaders = ({ build }: { build: string }) => ({ 'x-app-platform': 'ios', 'x-app-build': build });
const LEGACY_IOS_HEADERS = { 'expo-origin': IOS_APP_ORIGIN };

const getUser = ({ headers }: { headers: Record<string, string> }) =>
  helpers.makeRequest<ErrorResponse>({ method: 'get', url: '/user', headers });

const getSession = ({ headers }: { headers: Record<string, string> }) =>
  helpers.makeAuthRequest({ method: 'get', url: '/auth/get-session', headers });

describe('iOS client version gate', () => {
  let minBuildBeforeTest: string | undefined;

  beforeEach(() => {
    minBuildBeforeTest = process.env.IOS_MIN_SUPPORTED_BUILD;
    delete process.env.IOS_MIN_SUPPORTED_BUILD;
  });

  afterEach(() => {
    if (minBuildBeforeTest === undefined) {
      delete process.env.IOS_MIN_SUPPORTED_BUILD;
    } else {
      process.env.IOS_MIN_SUPPORTED_BUILD = minBuildBeforeTest;
    }
  });

  describe('without a minimum build', () => {
    it('serves old and legacy builds', async () => {
      expect((await getUser({ headers: iosHeaders({ build: '2001010000' }) })).statusCode).toBe(200);
      expect((await getUser({ headers: LEGACY_IOS_HEADERS })).statusCode).toBe(200);
      expect((await getSession({ headers: iosHeaders({ build: '2001010000' }) })).statusCode).toBe(200);
    });

    it('treats an empty minimum as unset', async () => {
      process.env.IOS_MIN_SUPPORTED_BUILD = '';

      expect((await getUser({ headers: iosHeaders({ build: '2001010000' }) })).statusCode).toBe(200);
    });

    it('serves every build when the minimum is not a build number', async () => {
      process.env.IOS_MIN_SUPPORTED_BUILD = 'abc';

      expect((await getUser({ headers: iosHeaders({ build: '2001010000' }) })).statusCode).toBe(200);
    });
  });

  describe('with a minimum build', () => {
    beforeEach(() => {
      process.env.IOS_MIN_SUPPORTED_BUILD = MIN_BUILD;
    });

    it('answers 426 to an older build', async () => {
      const res = await getUser({ headers: iosHeaders({ build: '2610311200' }) });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('serves an equal or newer build', async () => {
      expect((await getUser({ headers: iosHeaders({ build: MIN_BUILD }) })).statusCode).toBe(200);
      expect((await getUser({ headers: iosHeaders({ build: '2611011201' }) })).statusCode).toBe(200);
    });

    it('serves a debug build', async () => {
      expect((await getUser({ headers: iosHeaders({ build: 'dev' }) })).statusCode).toBe(200);
    });

    it('answers 426 to a legacy build that sends only expo-origin', async () => {
      const res = await getUser({ headers: LEGACY_IOS_HEADERS });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('answers 426 to a malformed build', async () => {
      const res = await getUser({ headers: iosHeaders({ build: '26110112ab' }) });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('compares builds as numbers', async () => {
      const res = await getUser({ headers: iosHeaders({ build: '999' }) });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('answers 426 to a build number too long to compare exactly', async () => {
      const res = await getUser({ headers: iosHeaders({ build: '9'.repeat(400) }) });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('answers 426 to an iOS request without x-app-build', async () => {
      const res = await getUser({ headers: { 'x-app-platform': 'ios' } });

      expect(res.statusCode).toBe(426);
      expect(res.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);
    });

    it('serves a web request without iOS headers', async () => {
      expect((await getUser({ headers: {} })).statusCode).toBe(200);
    });

    it('gates /auth routes too', async () => {
      const outdated = await getSession({ headers: iosHeaders({ build: '2610311200' }) });
      expect(outdated.statusCode).toBe(426);
      expect(outdated.body.response.code).toBe(API_ERROR_CODES.clientUpdateRequired);

      expect((await getSession({ headers: LEGACY_IOS_HEADERS })).statusCode).toBe(426);
      expect((await getSession({ headers: iosHeaders({ build: MIN_BUILD }) })).statusCode).toBe(200);
      expect((await getSession({ headers: iosHeaders({ build: 'dev' }) })).statusCode).toBe(200);
      expect((await getSession({ headers: {} })).statusCode).toBe(200);
    });
  });
});
