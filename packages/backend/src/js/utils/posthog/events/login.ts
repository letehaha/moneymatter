import { trackEvent } from '../index';

export type LoginMethod = 'email' | 'google' | 'github' | 'apple' | 'oidc' | 'passkey';

/**
 * Track user login event.
 */
export function trackLogin({
  userId,
  method,
  sessionId,
}: {
  userId: string | number;
  method: LoginMethod;
  sessionId?: string | null;
}): void {
  trackEvent({
    userId,
    event: 'user_logged_in',
    properties: {
      login_method: method,
    },
    sessionId,
  });
}
