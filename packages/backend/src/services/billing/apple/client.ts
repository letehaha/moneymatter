import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
  type Status,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';
import { BadRequestError } from '@js/errors';
import { captureException } from '@js/utils/sentry';
import { X509Certificate } from 'node:crypto';

/** Apple Root CA - G3, SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79. */
const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

/** The environments a real purchase can come from. Xcode and LocalTesting payloads fail verification. */
export type AppleEnvironment = Environment.PRODUCTION | Environment.SANDBOX;

export interface AppleSubscriptionState {
  status: Status;
  transaction: JWSTransactionDecodedPayload;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
}

interface AppleConfig {
  bundleId: string;
  appAppleId: number;
  issuerId: string;
  keyId: string;
  privateKey: string;
}

const readConfig = (): AppleConfig => {
  const env = {
    APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID,
    APPLE_APP_ID: process.env.APPLE_APP_ID,
    APPLE_IAP_ISSUER_ID: process.env.APPLE_IAP_ISSUER_ID,
    APPLE_IAP_KEY_ID: process.env.APPLE_IAP_KEY_ID,
    APPLE_IAP_PRIVATE_KEY: process.env.APPLE_IAP_PRIVATE_KEY,
  };
  const missing = Object.entries(env)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length || !Number.isInteger(Number(env.APPLE_APP_ID))) {
    throw new Error(`App Store billing is not configured: ${missing.join(', ') || 'APPLE_APP_ID is not a number'}`);
  }
  return {
    bundleId: env.APPLE_BUNDLE_ID!,
    appAppleId: Number(env.APPLE_APP_ID),
    issuerId: env.APPLE_IAP_ISSUER_ID!,
    keyId: env.APPLE_IAP_KEY_ID!,
    // Env files often carry the .p8 on one line with literal `\n`.
    privateKey: env.APPLE_IAP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  };
};

const ROOT_CERTIFICATES = [new X509Certificate(APPLE_ROOT_CA_G3).raw];

const verifiers = new Map<AppleEnvironment, SignedDataVerifier>();
const apiClients = new Map<AppleEnvironment, AppStoreServerAPIClient>();

const getVerifier = ({ environment }: { environment: AppleEnvironment }): SignedDataVerifier => {
  let verifier = verifiers.get(environment);
  if (!verifier) {
    const { bundleId, appAppleId } = readConfig();
    verifier = new SignedDataVerifier(ROOT_CERTIFICATES, true, environment, bundleId, appAppleId);
    verifiers.set(environment, verifier);
  }
  return verifier;
};

const getApiClient = ({ environment }: { environment: AppleEnvironment }): AppStoreServerAPIClient => {
  let client = apiClients.get(environment);
  if (!client) {
    const { privateKey, keyId, issuerId, bundleId } = readConfig();
    client = new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment);
    apiClients.set(environment, client);
  }
  return client;
};

export const toAppleEnvironment = ({ environment }: { environment: string | undefined }): AppleEnvironment => {
  if (environment === Environment.PRODUCTION || environment === Environment.SANDBOX) return environment;
  throw new BadRequestError({ message: `Unsupported App Store environment "${environment}".` });
};

const rejectAsInvalid = ({ error }: { error: unknown }): never => {
  if (error instanceof VerificationException && error.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
    const reason = VerificationStatus[error.status];
    // Also what a wrong APPLE_BUNDLE_ID / APPLE_APP_ID looks like, so it must not stay a quiet 400.
    if (error.status === VerificationStatus.INVALID_APP_IDENTIFIER) {
      captureException({ error: new Error(`App Store payload for another app: ${reason}`) });
    }
    throw new BadRequestError({ message: `Invalid App Store signature (${reason}).` });
  }
  throw error;
};

/**
 * Production first, then Sandbox: App Review buys with sandbox accounts against the
 * production server. A retryable failure (OCSP unreachable) stays a 500 so the caller retries.
 */
const verifyInEitherEnvironment = async <T>({
  verify,
}: {
  verify: (verifier: SignedDataVerifier) => Promise<T>;
}): Promise<T> => {
  try {
    return await verify(getVerifier({ environment: Environment.PRODUCTION }));
  } catch (error) {
    if (!(error instanceof VerificationException) || error.status !== VerificationStatus.INVALID_ENVIRONMENT) {
      return rejectAsInvalid({ error });
    }
  }
  try {
    return await verify(getVerifier({ environment: Environment.SANDBOX }));
  } catch (error) {
    return rejectAsInvalid({ error });
  }
};

export const verifyAppleTransaction = ({
  signedTransaction,
}: {
  signedTransaction: string;
}): Promise<JWSTransactionDecodedPayload> =>
  verifyInEitherEnvironment({ verify: (verifier) => verifier.verifyAndDecodeTransaction(signedTransaction) });

export const verifyAppleNotification = ({
  signedPayload,
}: {
  signedPayload: string;
}): Promise<ResponseBodyV2DecodedPayload> =>
  verifyInEitherEnvironment({ verify: (verifier) => verifier.verifyAndDecodeNotification(signedPayload) });

/** Apple's current view of one subscription, so the order notifications arrive in never matters. */
export const getAppleSubscriptionState = async ({
  originalTransactionId,
  environment,
}: {
  originalTransactionId: string;
  environment: AppleEnvironment;
}): Promise<AppleSubscriptionState> => {
  const response = await getApiClient({ environment })
    .getAllSubscriptionStatuses(originalTransactionId)
    .catch((error: unknown) => {
      // The library's errors carry no message, only these fields.
      if (!(error instanceof APIException)) throw error;
      throw new Error(
        `App Store API ${error.httpStatusCode} (${error.apiError ?? 'no code'}: ${error.errorMessage ?? 'no message'}) for ${originalTransactionId} (${environment})`,
        { cause: error },
      );
    });
  const item = response.data
    ?.flatMap((group) => group.lastTransactions ?? [])
    .find((last) => last.originalTransactionId === originalTransactionId);
  if (!item?.signedTransactionInfo || item.status === undefined) {
    throw new Error(`App Store returned no status for subscription ${originalTransactionId} (${environment})`);
  }

  const verifier = getVerifier({ environment });
  const [transaction, renewalInfo] = await Promise.all([
    verifier.verifyAndDecodeTransaction(item.signedTransactionInfo),
    item.signedRenewalInfo ? verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo) : null,
  ]);
  return { status: item.status, transaction, renewalInfo };
};
