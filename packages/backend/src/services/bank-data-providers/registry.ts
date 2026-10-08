import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils';

import { BaseBankDataProvider } from './base-provider';
import { ProviderMetadata } from './types';

class BankProviderRegistry {
  private providers = new Map<BANK_PROVIDER_TYPE, BaseBankDataProvider>();

  /** @throws Error if provider type is already registered */
  register(provider: BaseBankDataProvider): void {
    const providerType = provider.metadata.type;

    if (this.providers.has(providerType)) {
      throw new Error(t({ key: 'errors.providerAlreadyRegistered', variables: { providerType } }));
    }

    this.providers.set(providerType, provider);
    logger.info(`Registered bank data provider: ${providerType}`);
  }

  /** @throws Error if provider type is not registered */
  get(type: BANK_PROVIDER_TYPE): BaseBankDataProvider {
    const provider = this.providers.get(type);

    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ') || 'none';
      throw new Error(t({ key: 'errors.providerNotRegistered', variables: { providerType: type, available } }));
    }

    return provider;
  }

  listAll(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((provider) => provider.metadata);
  }

  listTypes(): BANK_PROVIDER_TYPE[] {
    return Array.from(this.providers.keys());
  }
}

export const bankProviderRegistry = new BankProviderRegistry();
