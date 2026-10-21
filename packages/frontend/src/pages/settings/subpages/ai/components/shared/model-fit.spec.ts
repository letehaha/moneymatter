import type { AIModelCapabilities } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { LONG_ANSWER_MIN_TOKENS, checkModelFit } from './model-fit';

const capabilities = (overrides: Partial<AIModelCapabilities> = {}): AIModelCapabilities => ({
  inputs: ['text', 'image', 'pdf'],
  maxOutputTokens: 65_536,
  structuredOutput: true,
  toolCalling: true,
  ...overrides,
});

describe('checkModelFit', () => {
  it('reads as unknown when the catalog does not know the model', () => {
    expect(checkModelFit({ needs: ['readsFiles'], capabilities: null })).toEqual({ verdict: 'unknown' });
  });

  it('passes a model that covers every need', () => {
    expect(checkModelFit({ needs: ['textOnly', 'longAnswers', 'runsOften'], capabilities: capabilities() })).toEqual({
      verdict: 'fit',
      checks: [
        { kind: 'readsText', ok: true },
        { kind: 'longAnswers', ok: true },
      ],
      warning: null,
    });
  });

  it('names PDFs alone when the model reads images but not PDFs', () => {
    expect(
      checkModelFit({
        needs: ['readsFiles', 'structuredAnswers'],
        capabilities: capabilities({ inputs: ['text', 'image'] }),
      }),
    ).toEqual({
      verdict: 'gaps',
      checks: [
        { kind: 'readsImages', ok: true },
        { kind: 'readsPdfs', ok: false },
        { kind: 'structuredAnswers', ok: true },
      ],
      warning: 'readsPdfs',
    });
  });

  it('names files as one warning when a text-only model reads neither kind', () => {
    const fit = checkModelFit({ needs: ['readsFiles'], capabilities: capabilities({ inputs: ['text'] }) });

    expect(fit).toMatchObject({ verdict: 'gaps', warning: 'readsFiles' });
  });

  it('fails long answers below the output ceiling the backend asks for', () => {
    const fit = checkModelFit({
      needs: ['longAnswers'],
      capabilities: capabilities({ maxOutputTokens: LONG_ANSWER_MIN_TOKENS - 1 }),
    });

    expect(fit).toMatchObject({ verdict: 'gaps', warning: 'longAnswers' });
  });

  it('leaves out a need the catalog does not list instead of failing it', () => {
    expect(
      checkModelFit({
        needs: ['longAnswers', 'structuredAnswers', 'toolCalling'],
        capabilities: capabilities({ maxOutputTokens: null, structuredOutput: null, toolCalling: null }),
      }),
    ).toEqual({ verdict: 'fit', checks: [], warning: null });
  });

  it('fails a model the catalog lists without tool calling', () => {
    const fit = checkModelFit({ needs: ['toolCalling'], capabilities: capabilities({ toolCalling: false }) });

    expect(fit).toEqual({ verdict: 'gaps', checks: [{ kind: 'toolCalling', ok: false }], warning: 'toolCalling' });
  });

  it('passes a model the catalog lists with tool calling', () => {
    expect(checkModelFit({ needs: ['toolCalling'], capabilities: capabilities() })).toEqual({
      verdict: 'fit',
      checks: [{ kind: 'toolCalling', ok: true }],
      warning: null,
    });
  });
});
