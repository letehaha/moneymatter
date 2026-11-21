import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';

describe('Bank connection externalUrl E2E', () => {
  it('defaults externalUrl to null when connecting without one, and accepts one on connect', async () => {
    const { connectionId: defaultConnId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      providerName: 'Default Connection',
      raw: true,
    });

    const { connectionId: withUrlConnId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      providerName: 'Linked Connection',
      externalUrl: 'https://beta-bridge.simplefin.org/',
      raw: true,
    });

    const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
    expect(connections.find((c) => c.id === defaultConnId)?.externalUrl).toBeNull();
    expect(connections.find((c) => c.id === withUrlConnId)?.externalUrl).toBe('https://beta-bridge.simplefin.org/');

    const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
      connectionId: withUrlConnId,
      raw: true,
    });
    expect(details.externalUrl).toBe('https://beta-bridge.simplefin.org/');
  });

  it('sets, preserves across rename, and clears externalUrl via PATCH', async () => {
    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      providerName: 'Editable Connection',
      raw: true,
    });

    const setRes = await helpers.bankDataProviders.updateConnectionDetails({
      connectionId,
      externalUrl: 'https://portal.bank.example/bridge',
      raw: true,
    });
    expect(setRes.connection.externalUrl).toBe('https://portal.bank.example/bridge');

    const renamed = await helpers.bankDataProviders.updateConnectionDetails({
      connectionId,
      providerName: 'Renamed Connection',
      raw: true,
    });
    expect(renamed.connection.providerName).toBe('Renamed Connection');
    expect(renamed.connection.externalUrl).toBe('https://portal.bank.example/bridge');

    const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
    expect(connections.find((c) => c.id === connectionId)?.externalUrl).toBe('https://portal.bank.example/bridge');

    const cleared = await helpers.bankDataProviders.updateConnectionDetails({
      connectionId,
      externalUrl: null,
      raw: true,
    });
    expect(cleared.connection.externalUrl).toBeNull();

    const { connection: detailsAfterClear } = await helpers.bankDataProviders.getConnectionDetails({
      connectionId,
      raw: true,
    });
    expect(detailsAfterClear.externalUrl).toBeNull();
  });

  it('rejects invalid URLs on connect and update, and returns 404 for unknown connections', async () => {
    for (const badUrl of [
      'ftp://bank.example',
      'javascript:alert(1)',
      'not-a-url',
      '',
      `https://bank.example/${'a'.repeat(2049)}`,
    ]) {
      const connectRes = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        externalUrl: badUrl,
        raw: false,
      });
      expect(connectRes.statusCode).toBe(ERROR_CODES.ValidationError);
    }

    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      providerName: 'Validation Connection',
      raw: true,
    });

    for (const badUrl of [
      'ftp://bank.example',
      'javascript:alert(1)',
      'not-a-url',
      '',
      `https://bank.example/${'a'.repeat(2049)}`,
    ]) {
      const updateRes = await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        externalUrl: badUrl,
        raw: false,
      });
      expect(updateRes.statusCode).toBe(ERROR_CODES.ValidationError);
    }

    const emptyRes = await helpers.bankDataProviders.updateConnectionDetails({ connectionId, raw: false });
    expect(emptyRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const notFoundRes = await helpers.bankDataProviders.updateConnectionDetails({
      connectionId: generateRandomRecordId(),
      externalUrl: 'https://bank.example/',
      raw: false,
    });
    expect(notFoundRes.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
