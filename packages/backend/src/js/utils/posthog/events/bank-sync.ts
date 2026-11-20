import { trackEvent } from '../index';

export type BankProvider = 'monobank' | 'enable_banking' | 'lunchflow' | 'walutomat' | 'simplefin' | 'akahu';

/**
 * Track bank connection completion.
 */
export function trackBankConnected({
  userId,
  provider,
  accountsCount,
  sessionId,
}: {
  userId: string | number;
  provider: BankProvider;
  accountsCount: number;
  sessionId?: string | null;
}): void {
  trackEvent({
    userId,
    event: 'bank_connected',
    properties: {
      provider,
      accounts_count: accountsCount,
    },
    sessionId,
  });
}
