import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';
import { logger } from '@js/utils';

import { fetchBody } from './http';

/** The host CoinGecko serves coin images from. Only it is fetched, so no outbound guard is needed. */
const COINGECKO_IMAGE_HOSTS = new Set(['coin-images.coingecko.com']);
const COIN_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** A CoinGecko coin image as a data URL, or `null` (logged) when it cannot be downloaded. */
export const downloadCoinLogo = async ({
  url,
  fetchImpl = globalThis.fetch,
}: {
  url: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<string | null> => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' || !COINGECKO_IMAGE_HOSTS.has(hostname)) {
      throw new Error('not a CoinGecko image URL');
    }

    const { body, contentType } = await fetchBody({
      url,
      accept: [...COIN_LOGO_TYPES].join(', '),
      maxBytes: LOGO_IMAGE_MAX_BYTES,
      fetchImpl,
    });
    const type = contentType?.split(';')[0]?.trim().toLowerCase();
    if (!type || !COIN_LOGO_TYPES.has(type)) throw new Error(`unsupported content type ${contentType}`);

    return `data:${type};base64,${body.toString('base64')}`;
  } catch (error) {
    logger.warn(`The CoinGecko coin logo was not downloaded, the logo stays as it was: ${(error as Error).message}`);

    return null;
  }
};
