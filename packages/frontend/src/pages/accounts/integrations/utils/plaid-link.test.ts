import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = { onSuccess: (publicToken: string) => void; onExit: (error: unknown) => void };

let scripts: HTMLScriptElement[];
const handler = { open: vi.fn(), destroy: vi.fn() };
let options: Options;
const sdk = {
  create: vi.fn((created: Options) => {
    options = created;
    return handler;
  }),
};

const loadModule = async () => (await import('./plaid-link')).openPlaidLink;
const open = (openPlaidLink: Awaited<ReturnType<typeof loadModule>>) =>
  openPlaidLink({ linkToken: 'link-token', signal: new AbortController().signal, beforeOpen: async () => {} });
const scriptLoaded = async () => {
  await vi.waitFor(() => expect(scripts.length).toBeGreaterThan(0));
  scripts.at(-1)!.onload?.(new Event('load'));
};

describe('openPlaidLink', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    scripts = [];
    vi.spyOn(document.head, 'append').mockImplementation((node) => {
      scripts.push(node as HTMLScriptElement);
    });
    (window as Window & { Plaid?: typeof sdk }).Plaid = sdk;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves cancelled when Link exits without an error', async () => {
    const result = open(await loadModule());
    await scriptLoaded();
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    options.onExit(null);

    await expect(result).resolves.toEqual({ status: 'cancelled' });
    expect(handler.destroy).toHaveBeenCalled();
  });

  it('rejects with the Plaid error as the cause', async () => {
    const result = open(await loadModule());
    await scriptLoaded();
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    const error = { error_code: 'INSTITUTION_DOWN', error_type: 'INSTITUTION_ERROR', display_message: 'Bank is down' };
    options.onExit(error);

    await expect(result).rejects.toMatchObject({ cause: error });
    expect(handler.destroy).toHaveBeenCalled();
  });

  it('retries the script after a load error', async () => {
    const openPlaidLink = await loadModule();
    const failed = open(openPlaidLink);
    await vi.waitFor(() => expect(scripts).toHaveLength(1));
    scripts[0]!.onerror?.(new Event('error'));
    await expect(failed).rejects.toThrow('Plaid Link could not load');

    const retried = open(openPlaidLink);
    await vi.waitFor(() => expect(scripts).toHaveLength(2));
    scripts[1]!.onload?.(new Event('load'));
    await vi.waitFor(() => expect(handler.open).toHaveBeenCalled());
    options.onSuccess('public-token');

    await expect(retried).resolves.toEqual({ status: 'success', publicToken: 'public-token' });
    expect(handler.destroy).toHaveBeenCalled();
  });
});
