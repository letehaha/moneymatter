import { describe, expect, it, jest } from '@jest/globals';

jest.mock('./card-labels', () => ({ resolveCardLabels: jest.fn(async () => ({})) }));
jest.mock('./snapshot', () => ({ buildSnapshot: jest.fn(async () => ({ baseCurrencyCode: 'USD' })) }));
jest.mock('./previews/money-currencies', () => ({ resolveArgsOnlyMoneyCurrencies: jest.fn() }));
jest.mock('./previews', () => ({ PREVIEW_RESOLVERS: { failing: jest.fn() } }));
jest.mock('@js/utils/logger', () => ({ logger: { error: jest.fn() } }));

import { logger } from '@js/utils/logger';

import { resolveCardLabels } from './card-labels';
import { computeCardState } from './card-state';
import { PREVIEW_RESOLVERS } from './previews';
import { resolveArgsOnlyMoneyCurrencies } from './previews/money-currencies';
import { PreviewError } from './previews/preview-helpers';

const policy = { name: 'create_tracker_line', previewResolver: null, danger: 'none', egress: null } as never;
const state = () => computeCardState({ userId: 7, policy, args: {}, parents: [] });

describe('computeCardState of a card with no preview resolver', () => {
  it('stores the currencies it read beside the names of the records', async () => {
    jest.mocked(resolveArgsOnlyMoneyCurrencies).mockResolvedValue({ limitAmount: 'UAH' });
    jest.mocked(resolveCardLabels).mockResolvedValue({ 'tracker:1': 'Home' });

    expect((await state()).preview).toEqual({
      before: { moneyCurrencies: { limitAmount: 'UAH' } },
      labels: { 'tracker:1': 'Home' },
    });
  });

  it('has a preview with the currencies alone', async () => {
    jest.mocked(resolveArgsOnlyMoneyCurrencies).mockResolvedValue({ limitAmount: 'UAH' });
    jest.mocked(resolveCardLabels).mockResolvedValue({});

    expect((await state()).preview).toEqual({ before: { moneyCurrencies: { limitAmount: 'UAH' } } });
  });

  it('stays without a preview when it read neither', async () => {
    jest.mocked(resolveArgsOnlyMoneyCurrencies).mockResolvedValue(null);
    jest.mocked(resolveCardLabels).mockResolvedValue({});

    expect((await state()).preview).toBeNull();
  });
});

const failWith = ({ error }: { error: Error }) =>
  jest.mocked((PREVIEW_RESOLVERS as unknown as { failing: () => Promise<never> }).failing).mockRejectedValue(error);

describe('computeCardState of a card whose resolver fails', () => {
  const failingPolicy = {
    name: 'update_subscription',
    previewResolver: 'failing',
    danger: 'none',
    egress: null,
  } as never;

  it('shows the generic message for an unexpected error and keeps the error for the log', async () => {
    const error = new Error('invalid input syntax for type uuid: "01a14b51-73c8-af44-bc2ce032ca30"');
    failWith({ error });

    const { error: cardError, preview } = await computeCardState({
      userId: 7,
      policy: failingPolicy,
      args: {},
      parents: [],
    });

    expect(preview).toBeNull();
    expect(cardError).toEqual({
      messageKey: 'chat.cards.previewFailed',
      message: 'The preview could not be prepared',
    });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error }));
  });

  it('shows the message of a preview error as it is', async () => {
    jest.mocked(logger.error).mockClear();
    failWith({
      error: new PreviewError({ messageKey: 'chat.cards.targetNotFound', message: 'The payee was not found' }),
    });

    const { error: cardError } = await computeCardState({ userId: 7, policy: failingPolicy, args: {}, parents: [] });

    expect(cardError).toEqual({ messageKey: 'chat.cards.targetNotFound', message: 'The payee was not found' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
