import { AI_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  CONNECTION_DEFAULT_MODEL_VALUE,
  buildConnectionModelOptions,
  findSelectedConnectionModelOption,
} from './connection-model-options';

const OLLAMA = { provider: AI_PROVIDER.custom, model: 'llama3.2' } as const;

describe('buildConnectionModelOptions', () => {
  it('starts with the connection default and lists the other models the provider serves', () => {
    const options = buildConnectionModelOptions({
      connection: OLLAMA,
      liveModels: ['llama3.2', 'llama3.2:70b', 'qwen2.5'],
      selectedModelId: null,
    });

    expect(options).toEqual([
      { value: CONNECTION_DEFAULT_MODEL_VALUE, kind: 'default', model: 'llama3.2', name: 'llama3.2' },
      { value: 'llama3.2:70b', kind: 'model', model: 'llama3.2:70b', name: 'llama3.2:70b' },
      { value: 'qwen2.5', kind: 'model', model: 'qwen2.5', name: 'qwen2.5' },
    ]);
  });

  it('drops a listed model that is the connection default, and a duplicate', () => {
    const options = buildConnectionModelOptions({
      connection: OLLAMA,
      liveModels: ['qwen2.5', 'llama3.2', 'qwen2.5'],
      selectedModelId: null,
    });

    expect(options.map((option) => option.value)).toEqual([CONNECTION_DEFAULT_MODEL_VALUE, 'qwen2.5']);
  });

  it('keeps a stored model the provider no longer lists, so the select can still show it', () => {
    const options = buildConnectionModelOptions({ connection: OLLAMA, liveModels: [], selectedModelId: 'gone-model' });

    expect(options.map((option) => option.value)).toEqual([CONNECTION_DEFAULT_MODEL_VALUE, 'gone-model']);
  });

  it('never lets a model id collide with the default option value', () => {
    const options = buildConnectionModelOptions({
      connection: OLLAMA,
      liveModels: ['default'],
      selectedModelId: null,
    });

    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });
});

describe('findSelectedConnectionModelOption', () => {
  const options = buildConnectionModelOptions({
    connection: OLLAMA,
    liveModels: ['qwen2.5'],
    selectedModelId: null,
  });

  it('selects the default option for no model', () => {
    expect(findSelectedConnectionModelOption({ options, modelId: null })?.kind).toBe('default');
  });

  it('selects the option of the stored model', () => {
    expect(findSelectedConnectionModelOption({ options, modelId: 'qwen2.5' })?.value).toBe('qwen2.5');
  });

  it('selects nothing for a model that is not offered', () => {
    expect(findSelectedConnectionModelOption({ options, modelId: 'missing' })).toBeNull();
  });
});
