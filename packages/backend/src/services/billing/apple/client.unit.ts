import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestError } from '@js/errors';

import { getAppleSubscriptionState, verifyAppleTransaction } from './client';

jest.mock('@apple/app-store-server-library', () => ({
  ...jest.requireActual<object>('@apple/app-store-server-library'),
  SignedDataVerifier: jest.fn(),
  AppStoreServerAPIClient: jest.fn(),
}));

type Outcome = VerificationStatus | 'ok';

const outcomes: Record<string, Outcome> = {};
const verifyCalls: string[] = [];

const decodeIn = (environment: Environment) => async () => {
  verifyCalls.push(environment);
  const outcome = outcomes[environment];
  if (outcome === 'ok') return { originalTransactionId: '1', environment };
  throw new VerificationException(outcome!);
};

describe('verifyAppleTransaction', () => {
  beforeAll(() => {
    Object.assign(process.env, {
      APPLE_BUNDLE_ID: 'app.moneymatter.mobile',
      APPLE_APP_ID: '1234567890',
      APPLE_IAP_ISSUER_ID: 'issuer',
      APPLE_IAP_KEY_ID: 'key',
      APPLE_IAP_PRIVATE_KEY: 'not-a-key',
    });
    jest.mocked(SignedDataVerifier).mockImplementation(
      (_roots, _online, environment) =>
        ({
          verifyAndDecodeTransaction: decodeIn(environment),
          verifyAndDecodeRenewalInfo: async () => ({ autoRenewStatus: 1 }),
        }) as unknown as jest.MockedObject<SignedDataVerifier>,
    );
  });

  beforeEach(() => {
    verifyCalls.length = 0;
  });

  const arrange = ({ production, sandbox }: { production: Outcome; sandbox: Outcome }) => {
    outcomes[Environment.PRODUCTION] = production;
    outcomes[Environment.SANDBOX] = sandbox;
  };

  it('accepts a Production payload without trying Sandbox', async () => {
    arrange({ production: 'ok', sandbox: VerificationStatus.VERIFICATION_FAILURE });

    const transaction = await verifyAppleTransaction({ signedTransaction: 'jws' });
    expect(transaction.environment).toBe(Environment.PRODUCTION);
    expect(verifyCalls).toEqual([Environment.PRODUCTION]);
  });

  it('falls back to Sandbox when Production rejects only the environment', async () => {
    arrange({ production: VerificationStatus.INVALID_ENVIRONMENT, sandbox: 'ok' });

    const transaction = await verifyAppleTransaction({ signedTransaction: 'jws' });
    expect(transaction.environment).toBe(Environment.SANDBOX);
    expect(verifyCalls).toEqual([Environment.PRODUCTION, Environment.SANDBOX]);
  });

  it('rejects a bad signature as a validation error without trying Sandbox', async () => {
    arrange({ production: VerificationStatus.VERIFICATION_FAILURE, sandbox: 'ok' });

    await expect(verifyAppleTransaction({ signedTransaction: 'jws' })).rejects.toBeInstanceOf(BadRequestError);
    expect(verifyCalls).toEqual([Environment.PRODUCTION]);
  });

  it('rejects a payload neither environment verifies', async () => {
    arrange({ production: VerificationStatus.INVALID_ENVIRONMENT, sandbox: VerificationStatus.INVALID_APP_IDENTIFIER });

    await expect(verifyAppleTransaction({ signedTransaction: 'jws' })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('keeps a retryable failure retryable instead of calling the payload invalid', async () => {
    arrange({ production: VerificationStatus.RETRYABLE_VERIFICATION_FAILURE, sandbox: 'ok' });

    const error = await verifyAppleTransaction({ signedTransaction: 'jws' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VerificationException);
    expect(error).not.toBeInstanceOf(BadRequestError);
  });
});

const lookup = () => getAppleSubscriptionState({ originalTransactionId: '1', environment: Environment.PRODUCTION });

describe('getAppleSubscriptionState', () => {
  const getAllSubscriptionStatuses = jest.fn<AppStoreServerAPIClient['getAllSubscriptionStatuses']>();

  beforeAll(() => {
    jest
      .mocked(AppStoreServerAPIClient)
      .mockImplementation(
        () => ({ getAllSubscriptionStatuses }) as unknown as jest.MockedObject<AppStoreServerAPIClient>,
      );
    outcomes[Environment.PRODUCTION] = 'ok';
  });

  it('picks the subscription asked for out of every group', async () => {
    getAllSubscriptionStatuses.mockResolvedValue({
      data: [
        { lastTransactions: [{ originalTransactionId: '9', status: Status.ACTIVE, signedTransactionInfo: 'other' }] },
        { lastTransactions: [{ originalTransactionId: '1', status: Status.EXPIRED, signedTransactionInfo: 'ours' }] },
      ],
    });

    const state = await lookup();
    expect(state.status).toBe(Status.EXPIRED);
    expect(state.renewalInfo).toBeNull();
  });

  it('fails loudly when Apple returns nothing for the subscription', async () => {
    getAllSubscriptionStatuses.mockResolvedValue({ data: [] });

    await expect(lookup()).rejects.toThrow(/no status for subscription 1/);
  });

  it('names the API failure, which the library leaves without a message', async () => {
    getAllSubscriptionStatuses.mockRejectedValue(new APIException(401, null, 'Unauthenticated'));

    await expect(lookup()).rejects.toThrow(/App Store API 401 .*Unauthenticated/);
  });

  it('names the missing configuration', async () => {
    delete process.env.APPLE_IAP_KEY_ID;

    await expect(
      getAppleSubscriptionState({ originalTransactionId: '1', environment: Environment.SANDBOX }),
    ).rejects.toThrow(/APPLE_IAP_KEY_ID/);
  });
});
