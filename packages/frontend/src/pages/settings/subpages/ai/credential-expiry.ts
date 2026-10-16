import { addDays, isAfter, isBefore } from 'date-fns';

/** A stored sign-in turns into a warning this many days before it stops working. */
export const CREDENTIAL_EXPIRY_WARNING_DAYS = 14;

export type CredentialExpiryKind = 'valid' | 'expiring-soon' | 'expired';

export interface CredentialExpiry {
  kind: CredentialExpiryKind;
  expiresAt: Date;
}

/** Where a subscription connection's sign-in stands; null when it has no (readable) expiry date. */
export const getCredentialExpiry = ({
  expiresAt,
  now = new Date(),
}: {
  expiresAt: string | undefined;
  now?: Date;
}): CredentialExpiry | null => {
  if (!expiresAt) return null;

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;

  if (!isAfter(date, now)) return { kind: 'expired', expiresAt: date };
  if (isBefore(date, addDays(now, CREDENTIAL_EXPIRY_WARNING_DAYS))) return { kind: 'expiring-soon', expiresAt: date };
  return { kind: 'valid', expiresAt: date };
};
