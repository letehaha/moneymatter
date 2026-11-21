import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { PNG_1X1_BYTES, PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';

import { downloadCoinLogo } from './coin-logo';

const LOGO = 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png';

const imageResponse = ({ body = PNG_1X1_BYTES, type = 'image/png' }: { body?: Buffer; type?: string } = {}) =>
  new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': type } });

describe('downloadCoinLogo', () => {
  it('returns the image as a data URL', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(imageResponse({ type: 'image/png; charset=binary' }));

    expect(await downloadCoinLogo({ url: LOGO, fetchImpl })).toBe(PNG_1X1_DATA_URL);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it.each([
    ['another host', 'https://example.com/bitcoin.png'],
    ['plain http', 'http://coin-images.coingecko.com/coins/images/1/small/bitcoin.png'],
  ])('fetches nothing from %s', async (_name, url) => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(imageResponse());

    expect(await downloadCoinLogo({ url, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['an svg', () => imageResponse({ type: 'image/svg+xml' })],
    ['no content type', () => new Response(new Uint8Array(PNG_1X1_BYTES), { status: 200 })],
    ['an image over the size cap', () => imageResponse({ body: Buffer.alloc(LOGO_IMAGE_MAX_BYTES + 1) })],
    ['an error status', () => new Response('nope', { status: 404 })],
  ])('returns null for %s', async (_name, response) => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(response());

    expect(await downloadCoinLogo({ url: LOGO, fetchImpl })).toBeNull();
  });

  it('returns null when the request fails', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    expect(await downloadCoinLogo({ url: LOGO, fetchImpl })).toBeNull();
  });
});
