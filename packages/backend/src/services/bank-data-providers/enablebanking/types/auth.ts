/**
 * Authentication, Authorization & Session Types
 * https://enablebanking.com/docs/api/reference/
 */
import type { DeactivationReason } from '@bt/shared/types';

import { EnableBankingAccount } from './accounts';
import { ASPSP } from './aspsp';
import { AccountIdentification } from './common';
import { EnvironmentType, PSUType, ServiceType } from './enums';

/**
 * Credentials required to connect to Enable Banking
 * These are stored encrypted in the database
 */
export interface EnableBankingCredentials {
  /** Application ID from Enable Banking portal */
  appId: string;
  /** PEM-encoded RSA private key for JWT signing */
  privateKey: string;
  /** Session ID obtained after OAuth flow completion */
  sessionId?: string;
  /** Authorization ID from the initial auth request */
  authorizationId?: string;
}

/**
 * Summary of account info stored in connection metadata.
 * Contains minimal fields needed for matching and display.
 * @public
 */
export interface MetadataAccountSummary {
  /** Stable identifier across sessions - used for matching */
  identification_hash: string;
  /** Session-specific ID for API calls. Undefined if account is blocked/closed */
  uid?: string;
  /** IBAN for matching and display */
  iban?: string;
  /** Currency code for matching and display */
  currency: string;
  /** Account name for display */
  name?: string;
}

/**
 * Metadata stored for Enable Banking connection
 */
export interface EnableBankingMetadata {
  /** Selected bank name (e.g., "Nordea") */
  bankName: string;
  /** Bank country code (e.g., "FI", "SE") */
  bankCountry: string;
  /** OAuth state parameter for CSRF protection */
  state?: string;
  /** Authorization URL for user to complete OAuth */
  authUrl?: string;
  /** List of accounts available in this session (includes blocked accounts with uid=undefined) */
  accounts?: MetadataAccountSummary[];
  /** Consent validity period end date (ISO 8601) */
  consentValidUntil?: string;
  /** Consent validity period start date (ISO 8601) */
  consentValidFrom?: string;
  /** Maximum consent validity allowed by bank (in seconds) */
  bankMaxConsentValidity?: number;
  /** Consecutive auth-failure counter, kept by the base provider's auth tracking. */
  consecutiveAuthFailures?: number;
  /**
   * Why the connection was deactivated. `DEACTIVATION_REASON.AUTH_FAILURE`
   * signals the UI to prompt the user to reconnect; `null`/absent means the
   * connection was disconnected manually.
   */
  deactivationReason?: DeactivationReason | null;
}

/**
 * JWT payload for Enable Banking API authentication
 */
export interface EnableBankingJWTPayload {
  /** Issuer - always "enablebanking.com" */
  iss: string;
  /** Audience - always "api.enablebanking.com" */
  aud: string;
  /** Issued at timestamp (seconds) */
  iat: number;
  /** Expiration timestamp (seconds) - max 24 hours from iat */
  exp: number;
}

/**
 * Access scope configuration
 * https://enablebanking.com/docs/api/reference/#access
 * @public
 */
export interface Access {
  /**
   * Expiration timestamp for authorized session (RFC3339 format).
   * Cannot exceed 'now' + maximum_consent_validity from ASPSP.
   */
  valid_until: string;
  /** List of accounts for which access is requested */
  accounts?: AccountIdentification[];
  /** Request consent with balances access */
  balances?: boolean;
  /** Request consent with transactions access */
  transactions?: boolean;
}

/**
 * Request to start authorization flow
 * https://enablebanking.com/docs/api/reference/#startauthorizationrequest
 */
export interface StartAuthorizationRequest {
  /** Access scope configuration */
  access: Access;
  /** Bank selection */
  aspsp: ASPSP;
  /** State parameter for CSRF protection */
  state: string;
  /** Callback URL after authorization */
  redirect_url: string;
  /** PSU type */
  psu_type: PSUType;
  /** Specific authentication method to use */
  auth_method?: string;
  /** Pre-filled credentials for embedded flow */
  credentials?: Record<string, string>;
  /** Auto-submit credentials flag */
  credentials_autosubmit?: boolean;
  /** Preferred language (ISO 639-1) */
  language?: string;
  /** PSU identifier for the bank */
  psu_id?: string;
}

/**
 * Response from starting authorization
 * https://enablebanking.com/docs/api/reference/#startauthorizationresponse
 */
export interface StartAuthorizationResponse {
  /** URL to redirect user for authorization */
  url: string;
  /** Authorization ID for tracking */
  authorization_id: string;
}

/**
 * Request to create a session after authorization
 * https://enablebanking.com/docs/api/reference/#authorizesessionrequest
 */
export interface CreateSessionRequest {
  /** Authorization code from redirect callback */
  code: string;
}

/**
 * Response from creating a session (authorizing)
 * https://enablebanking.com/docs/api/reference/#authorizesessionresponse
 */
export interface CreateSessionResponse {
  /** Session ID for subsequent API calls */
  session_id: string;
  /** List of accounts accessible in this session */
  accounts: EnableBankingAccount[];
  /** ASPSP information */
  aspsp: ASPSP;
  /** PSU type used for authorization */
  psu_type: PSUType;
  /** Access scope granted */
  access: Access;
}

/**
 * Response from GET /sessions/{session_id}
 * https://enablebanking.com/docs/api/reference/#getsessionresponse
 * @public
 */
export interface GetSessionResponse {
  /** Session ID */
  session_id: string;
  /** List of accessible account UIDs */
  accounts: string[];
  /** ASPSP information */
  aspsp: ASPSP;
  /** PSU type */
  psu_type: PSUType;
  /** Access scope */
  access: Access;
  /** Session status */
  status?: string;
}

/**
 * OAuth callback parameters
 */
export interface OAuthCallbackParams {
  /** Authorization code */
  code: string;
  /** State parameter (should match the one sent in auth request) */
  state: string;
  /** Error code if authorization failed */
  error?: string;
  /** Error description */
  error_description?: string;
}

/**
 * Connection initialization parameters
 */
export interface EnableBankingConnectionParams {
  /** Application ID */
  appId: string;
  /** Private key (PEM format) */
  privateKey: string;
  /** Selected bank name */
  bankName: string;
  /** Bank country code */
  bankCountry: string;
  /** Optional redirect URL override */
  redirectUrl?: string;
  /** Maximum consent validity in seconds (from bank's ASPSP data) */
  maxConsentValidity?: number;
}

/**
 * Error response
 * https://enablebanking.com/docs/api/reference/#errorresponse
 * @public
 */
export interface ErrorResponse {
  /** Error code */
  error: string;
  /** Error description */
  message: string;
}

/**
 * Success response
 * https://enablebanking.com/docs/api/reference/#successresponse
 * @public
 */
export interface SuccessResponse {
  /** Success message */
  message: string;
}

/**
 * Application information response
 * https://enablebanking.com/docs/api/reference/#getapplicationresponse
 * @public
 */
export interface GetApplicationResponse {
  /** Application ID */
  app_id: string;
  /** Application name */
  name: string;
  /** Environment type */
  environment: EnvironmentType;
  /** Enabled services */
  services: ServiceType[];
}
