import { STRIPE_PRICE_IDS, type StripeEnvironment } from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import Stripe from 'stripe';

/** The version the webhook mapping and session params in this folder were written against. */
const STRIPE_API_VERSION = '2026-08-26.dahlia';

export const getStripeEnv = (): StripeEnvironment => {
  const env = process.env.STRIPE_ENV;
  if (env === 'live' || env === 'test') return env;
  throw new Error('STRIPE_ENV must be "test" or "live"');
};

/** An empty live price id would reach Stripe as a checkout for nothing, so fail before the call. */
const assertLivePriceIds = () => {
  const empty = Object.entries(STRIPE_PRICE_IDS.live).flatMap(([tier, cycles]) =>
    Object.entries(cycles)
      .filter(([, priceId]) => !priceId)
      .map(([cycle]) => `${tier}.${cycle}`),
  );
  if (empty.length) throw new Error(`STRIPE_PRICE_IDS.live has empty price ids: ${empty.join(', ')}`);
};

let client: Stripe | null = null;
let memoSecret: string | null = null;

export const getStripeClient = (): Stripe => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');

  if (!client || memoSecret !== secretKey) {
    if (getStripeEnv() === 'live') assertLivePriceIds();
    // Without AUTH_ORIGIN the frontend base URL falls back to localhost, which would
    // become Stripe's success_url and strand the buyer after payment.
    if (!isSelfHost() && !process.env.AUTH_ORIGIN) throw new Error('AUTH_ORIGIN is not configured');
    // Fetch transport rather than the SDK's default node:https client: it is the
    // only one the e2e HTTP mock intercepts.
    client = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });
    memoSecret = secretKey;
  }
  return client;
};

/** Stripe returns a referenced object as its id, or expanded. */
export const idOf = ({ ref }: { ref: string | { id: string } | null | undefined }): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);
