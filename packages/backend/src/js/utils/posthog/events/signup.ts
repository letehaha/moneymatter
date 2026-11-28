import { trackEvent } from '../index';

type SignupMethod = 'email' | 'google' | 'github' | 'apple' | 'passkey';

/**
 * Track user signup event.
 */
export function trackSignup({
  userId,
  email,
  method,
  sessionId,
}: {
  userId: string | number;
  email?: string;
  method: SignupMethod;
  sessionId?: string | null;
}): void {
  trackEvent({
    userId,
    event: 'user_signed_up',
    properties: {
      email,
      signup_method: method,
    },
    sessionId,
  });
}
