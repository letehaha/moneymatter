import { createClient, WalutomatHttpError } from 'walutomat-sdk';
import type { Currency, GetHistoryParams as SdkGetHistoryParams, HistoryItem, WalletBalance } from 'walutomat-sdk';

export type { Currency, WalletBalance, HistoryItem };
export { WalutomatHttpError };

/**
 * Extends the SDK's GetHistoryParams but relaxes strict union types to plain
 * strings so consumers don't need to cast.
 */
type GetHistoryParams = Omit<SdkGetHistoryParams, 'currencies' | 'operationType' | 'operationDetailedType'> & {
  currencies?: string[];
  operationType?: string;
  operationDetailedType?: string;
};

type SdkClient = ReturnType<typeof createClient>;

/**
 * Walutomat API client.
 * Thin wrapper around walutomat-sdk to keep the same interface for consumers.
 */
export class WalutomatApiClient {
  private readonly client: SdkClient;

  constructor({ apiKey, privateKey }: { apiKey: string; privateKey: string }) {
    this.client = createClient({ apiKey, privateKey });
  }

  /**
   * Test if the credentials are valid by making a simple API call.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getBalances();
      return true;
    } catch (error) {
      if (error instanceof WalutomatHttpError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          return false;
        }
      }
      // Signing errors (invalid key format) also mean invalid credentials
      if (error instanceof Error && error.message.includes('error:')) {
        return false;
      }
      throw error;
    }
  }

  async getBalances(): Promise<WalletBalance[]> {
    return this.client.account.getBalances();
  }

  async *getHistoryIterator(params?: Omit<GetHistoryParams, 'continueFrom'>): AsyncIterableIterator<HistoryItem> {
    yield* this.client.account.getHistoryIterator(params as Omit<SdkGetHistoryParams, 'continueFrom'>);
  }
}
