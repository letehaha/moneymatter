import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { resolveMerchantSimilarity } from './merchant-similarity';

const stubFetch = ({ status, body }: { status: number; body: unknown }) => {
  const mock = jest.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  global.fetch = mock as unknown as typeof global.fetch;
  return mock;
};

describe('resolveMerchantSimilarity without a TypeSafe key', () => {
  it('matches a legal vendor name against the short brand name a bank prints', async () => {
    const { similarityById, usedJev } = await resolveMerchantSimilarity({
      vendorName: 'Hetzner Online GmbH',
      candidates: [
        { id: 'brand', text: 'HETZNER' },
        { id: 'processor', text: 'PAYPAL *HETZNER 35314369001' },
        { id: 'other', text: 'Corner bakery' },
      ],
      allowJev: true,
    });

    expect(usedJev).toBe(false);
    expect(similarityById.brand).toBeGreaterThan(0.5);
    expect(similarityById.processor).toBeGreaterThan(0.5);
    expect(similarityById.other).toBe(0);
  });

  it('ranks the full name above a single shared word', async () => {
    const { similarityById } = await resolveMerchantSimilarity({
      vendorName: 'Acme Cloud Services',
      candidates: [
        { id: 'full', text: 'ACME CLOUD SERVICES' },
        { id: 'word', text: 'ACME' },
      ],
      allowJev: true,
    });

    expect(similarityById.full).toBeGreaterThan(similarityById.word!);
  });

  it('does not match on a company-form word alone', async () => {
    const { similarityById } = await resolveMerchantSimilarity({
      vendorName: 'Hetzner Online GmbH',
      candidates: [{ id: 'suffix-only', text: 'Siemens GmbH' }],
      allowJev: true,
    });

    expect(similarityById['suffix-only']).toBe(0);
  });
});

describe('resolveMerchantSimilarity with a TypeSafe key', () => {
  const CANDIDATES = [
    { id: 'tx-a', text: 'HETZNER' },
    { id: 'tx-b', text: 'Corner bakery' },
  ];

  let keyBeforeTest: string | undefined;
  let fetchBeforeTest: typeof global.fetch;

  const judge = () =>
    resolveMerchantSimilarity({ vendorName: 'Hetzner Online GmbH', candidates: CANDIDATES, allowJev: true });

  beforeEach(() => {
    keyBeforeTest = process.env.TYPESAFE_API_KEY;
    fetchBeforeTest = global.fetch;
    process.env.TYPESAFE_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (keyBeforeTest === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = keyBeforeTest;
    global.fetch = fetchBeforeTest;
  });

  it('maps each answer back to its candidate and clamps the judgement into 0..1', async () => {
    const fetchMock = stubFetch({
      status: 200,
      body: { answers: { tx_0: { type: 'noul', noul: 1.4 }, tx_1: { type: 'noul', noul: -0.2 } } },
    });

    const { similarityById, usedJev } = await judge();

    expect(usedJev).toBe(true);
    expect(similarityById).toEqual({ 'tx-a': 1, 'tx-b': 0 });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');

    const payload = JSON.parse(init.body as string) as { model: string; state: string };
    expect(payload.model).toBe('jev-latest');
    expect(payload.state).toContain('Hetzner Online GmbH');
    for (const candidate of CANDIDATES) expect(payload.state).toContain(candidate.text);
  });

  it('keeps the fuzzy scores when TypeSafe fails', async () => {
    stubFetch({ status: 500, body: {} });

    const { similarityById, usedJev } = await judge();

    expect(usedJev).toBe(false);
    expect(similarityById['tx-a']).toBeGreaterThan(0.5);
    expect(similarityById['tx-b']).toBe(0);
  });

  it('falls back to the fuzzy score for a candidate TypeSafe did not answer', async () => {
    stubFetch({ status: 200, body: { answers: { tx_1: { type: 'noul', noul: 1 } } } });

    const { similarityById } = await judge();

    expect(similarityById['tx-a']).toBeGreaterThan(0.5);
    expect(similarityById['tx-b']).toBe(1);
  });

  it('skips the call entirely when Jev is not allowed', async () => {
    stubFetch({ status: 200, body: { answers: { tx_0: { type: 'noul', noul: 0 } } } });

    const { similarityById, usedJev } = await resolveMerchantSimilarity({
      vendorName: 'Hetzner Online GmbH',
      candidates: CANDIDATES,
      allowJev: false,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(usedJev).toBe(false);
    expect(similarityById['tx-a']).toBeGreaterThan(0.5);
  });
});
