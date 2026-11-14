/**
 * Walutomat-specific types for the provider implementation.
 * Walutomat API returns monetary amounts as decimal strings (e.g., "100.50").
 */
import type { AuthTrackingMetadata } from '../types';

/**
 * Walutomat API credentials required for authentication.
 * Uses API key + RSA private key for RSA-SHA256 request signing.
 */
export interface WalutomatCredentials {
  apiKey: string;
  privateKey: string;
}

/**
 * Walutomat connection metadata stored alongside credentials
 */
export interface WalutomatMetadata extends AuthTrackingMetadata {
  walletCount?: number;
}
