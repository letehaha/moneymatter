import type { Entitlements } from './billing';
import type { RecordId } from './record-id';

/**
 * User roles for access control and feature gating.
 * - admin: Full access to all features including admin panel
 * - common: Regular registered user
 * - demo: Temporary demo user (auto-deleted after 4 hours)
 */
export const USER_ROLES = {
  admin: 'admin',
  common: 'common',
  demo: 'demo',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * Supported OAuth providers for authentication
 */
export enum OAUTH_PROVIDER {
  google = 'google',
  github = 'github',
}

// Array of all providers for iteration (e.g., trustedProviders config)
export const OAUTH_PROVIDERS_LIST = Object.values(OAUTH_PROVIDER);

export interface UserModel {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  middleName: string;
  avatar: string;
  totalBalance: number;
  defaultCategoryId: RecordId;
  authUserId?: RecordId;
  /** User role for access control. Defaults to 'common' for regular users. */
  role: UserRole;
  /** @deprecated Use role === 'admin' instead */
  isAdmin?: boolean;
  /** Feeds the demo-account expiry countdown. */
  createdAt: Date;
  /** Present on `GET /user` only. */
  entitlements?: Entitlements;
}

/** `GET /user` payload. Email comes from better-auth's ba_user, not the Users table. */
export type UserInfoResponse = UserModel & { email: string | null };
