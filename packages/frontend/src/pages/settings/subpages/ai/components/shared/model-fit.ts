import type { AIModelNeed } from '@/common/const';
import type { AIModelCapabilities } from '@bt/shared/types';

/** The output ceiling the backend asks for on row-emitting calls; a lower model limit cuts long files off. */
export const LONG_ANSWER_MIN_TOKENS = 32_000;

export type ModelFitCheckKind =
  | 'readsText'
  | 'readsImages'
  | 'readsPdfs'
  | 'longAnswers'
  | 'structuredAnswers'
  | 'toolCalling';

/** Both file kinds failing read as one warning */
export type ModelFitWarning = ModelFitCheckKind | 'readsFiles';

interface ModelFitCheck {
  kind: ModelFitCheckKind;
  ok: boolean;
}

export type ModelFit =
  | { verdict: 'unknown' }
  | {
      verdict: 'fit' | 'gaps';
      checks: ModelFitCheck[];
      /** The failing need to name next to the model field */
      warning: ModelFitWarning | null;
    };

const checksForNeed = ({
  need,
  capabilities,
}: {
  need: AIModelNeed;
  capabilities: AIModelCapabilities;
}): ModelFitCheck[] => {
  const { inputs, maxOutputTokens, structuredOutput, toolCalling } = capabilities;

  switch (need) {
    case 'textOnly':
      return [{ kind: 'readsText', ok: inputs.includes('text') }];
    case 'readsFiles':
      return [
        { kind: 'readsImages', ok: inputs.includes('image') },
        { kind: 'readsPdfs', ok: inputs.includes('pdf') },
      ];
    case 'longAnswers':
      return maxOutputTokens === null ? [] : [{ kind: 'longAnswers', ok: maxOutputTokens >= LONG_ANSWER_MIN_TOKENS }];
    case 'structuredAnswers':
      return structuredOutput === null ? [] : [{ kind: 'structuredAnswers', ok: structuredOutput }];
    case 'toolCalling':
      return toolCalling === null ? [] : [{ kind: 'toolCalling', ok: toolCalling }];
    case 'runsOften':
      return [];
  }
};

/** Checks a model against a feature's needs. A need the catalog doesn't list is left out, not failed. */
export const checkModelFit = ({
  needs,
  capabilities,
}: {
  needs: AIModelNeed[];
  capabilities: AIModelCapabilities | null;
}): ModelFit => {
  if (!capabilities) return { verdict: 'unknown' };

  const checks = needs.flatMap((need) => checksForNeed({ need, capabilities }));
  const failing = checks.filter((check) => !check.ok).map((check) => check.kind);
  const warning =
    failing.includes('readsImages') && failing.includes('readsPdfs') ? 'readsFiles' : (failing[0] ?? null);

  return { verdict: failing.length ? 'gaps' : 'fit', checks, warning };
};
