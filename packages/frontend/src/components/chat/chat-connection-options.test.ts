import { AI_PROVIDER, type AIConnectionInfo } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  INCLUDED_OPTION_VALUE,
  buildChatConnectionOptions,
  findSelectedChatConnectionOption,
} from './chat-connection-options';

const connection = (overrides: Partial<AIConnectionInfo> = {}): AIConnectionInfo => ({
  id: 'c1',
  provider: AI_PROVIDER.custom,
  name: 'Home Ollama',
  model: 'llama3.2',
  hasApiKey: false,
  createdAt: '2026-03-05T10:00:00.000Z',
  status: 'valid',
  lastValidatedAt: '2026-03-05T10:00:00.000Z',
  ...overrides,
});

describe('buildChatConnectionOptions', () => {
  it('lists the connections in their saved order, then the included model', () => {
    const options = buildChatConnectionOptions({
      connections: [connection({ id: 'c1', name: 'First' }), connection({ id: 'c2', name: 'Second', model: 'qwen' })],
      hasIncludedModel: true,
    });

    expect(options).toEqual([
      { value: 'c1', kind: 'connection', connectionId: 'c1', name: 'First', model: 'llama3.2', needsAttention: false },
      { value: 'c2', kind: 'connection', connectionId: 'c2', name: 'Second', model: 'qwen', needsAttention: false },
      { value: INCLUDED_OPTION_VALUE, kind: 'included', connectionId: null },
    ]);
  });

  it('leaves the included model out where none serves chat', () => {
    const options = buildChatConnectionOptions({ connections: [connection()], hasIncludedModel: false });

    expect(options.map((option) => option.kind)).toEqual(['connection']);
  });

  it('marks a connection flagged down', () => {
    const [option] = buildChatConnectionOptions({
      connections: [connection({ status: 'invalid' })],
      hasIncludedModel: false,
    });

    expect(option).toMatchObject({ needsAttention: true });
  });

  it('offers nothing when the user has no connection and no included model', () => {
    expect(buildChatConnectionOptions({ connections: [], hasIncludedModel: false })).toEqual([]);
  });
});

describe('findSelectedChatConnectionOption', () => {
  const options = buildChatConnectionOptions({ connections: [connection()], hasIncludedModel: true });

  it('selects the option of a connection id', () => {
    expect(findSelectedChatConnectionOption({ options, connectionId: 'c1' })).toMatchObject({ value: 'c1' });
  });

  it('selects the included model for null where one serves chat', () => {
    expect(findSelectedChatConnectionOption({ options, connectionId: null })).toMatchObject({ kind: 'included' });
  });

  it('selects nothing for null without an included model, and for an id that is gone', () => {
    const withoutIncluded = buildChatConnectionOptions({ connections: [connection()], hasIncludedModel: false });

    expect(findSelectedChatConnectionOption({ options: withoutIncluded, connectionId: null })).toBeNull();
    expect(findSelectedChatConnectionOption({ options, connectionId: 'deleted' })).toBeNull();
  });
});
