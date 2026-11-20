import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { logger } from '@js/utils/logger';
import { FUZZY_MIN_MATCH_CHAR_LENGTH, fuzzyFuseOptions } from '@services/payees/fuzzy-matcher';
import { normalizePayeeName } from '@services/payees/normalize-name';
import Fuse from 'fuse.js';

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const TYPESAFE_MODEL = 'jev-latest';
const TYPESAFE_TIMEOUT_MS = 5000;

const WORD_MATCH_WEIGHT = 0.85;
const MAX_VENDOR_WORDS = 3;
// ponytail: fixed stoplist, extend when real invoices show other company-form words winning matches
const LEGAL_SUFFIXES = new Set([
  'gmbh',
  'inc',
  'llc',
  'ltd',
  'corp',
  'company',
  'limited',
  'the',
  'and',
  'tov',
  'тов',
  'фоп',
]);

interface SimilarityCandidate {
  id: string;
  /** Note plus payee name — whatever text identifies the merchant on the transaction. */
  text: string;
}

interface TypeSafeAnswer {
  noul: number;
}

interface TypeSafeResponse {
  answers?: Record<string, TypeSafeAnswer | undefined>;
}

/** Fuse scores are distances: 0 is a perfect hit, so similarity is their complement. */
function fuseSimilarity({
  vendorName,
  candidates,
}: {
  vendorName: string;
  candidates: SimilarityCandidate[];
}): Record<string, number> {
  const query = normalizePayeeName({ raw: vendorName });
  const similarityById: Record<string, number> = Object.fromEntries(candidates.map((entry) => [entry.id, 0]));

  if (query.length < FUZZY_MIN_MATCH_CHAR_LENGTH) return similarityById;

  const fuse = new Fuse(
    candidates.map((entry) => ({ id: entry.id, text: normalizePayeeName({ raw: entry.text }) })),
    fuzzyFuseOptions<{ id: string; text: string }>(),
  );

  // Invoices carry the legal name ("Hetzner Online GmbH") while bank notes carry the brand
  // ("HETZNER"), so each distinctive word is tried on its own, at a discount to the full name.
  const words = query
    .split(' ')
    .filter((word) => word.length >= FUZZY_MIN_MATCH_CHAR_LENGTH && !LEGAL_SUFFIXES.has(word))
    .slice(0, MAX_VENDOR_WORDS);

  const searches = [{ pattern: query, weight: 1 }, ...words.map((pattern) => ({ pattern, weight: WORD_MATCH_WEIGHT }))];

  for (const { pattern, weight } of searches) {
    for (const hit of fuse.search(pattern)) {
      if (hit.score === undefined) continue;
      const similarity = Math.max(0, 1 - hit.score) * weight;
      similarityById[hit.item.id] = Math.max(similarityById[hit.item.id] ?? 0, similarity);
    }
  }

  return similarityById;
}

const questionKey = ({ index }: { index: number }) => `tx_${index}`;

class TypeSafeHttpError extends Error {
  constructor(readonly status: number) {
    super(`TypeSafe answered ${status}`);
  }
}

async function jevSimilarity({
  apiKey,
  vendorName,
  candidates,
  fallbackById,
}: {
  apiKey: string;
  vendorName: string;
  candidates: SimilarityCandidate[];
  fallbackById: Record<string, number>;
}): Promise<Record<string, number>> {
  const state = [
    `Other party on the invoice: ${vendorName}`,
    'Bank transaction descriptions:',
    ...candidates.map((entry, index) => `${questionKey({ index })}: ${entry.text}`),
  ].join('\n');

  const questions = Object.fromEntries(
    candidates.map((entry, index) => [
      questionKey({ index }),
      {
        type: 'noul',
        instructions: `Is the bank transaction description labelled "${questionKey({ index })}" a payment to or from "${vendorName}"?`,
        criteria: {
          true: 'The description names the same party, including abbreviations and payment-processor prefixes',
          false: 'The description names a different party, or no party at all',
        },
      },
    ]),
  );

  const response = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, model: TYPESAFE_MODEL, questions }),
    signal: AbortSignal.timeout(TYPESAFE_TIMEOUT_MS),
  });

  if (!response.ok) throw new TypeSafeHttpError(response.status);

  const { answers } = (await response.json()) as TypeSafeResponse;
  if (!answers) throw new Error('TypeSafe answered without any answers');

  return Object.fromEntries(
    candidates.map((entry, index) => {
      const noul = answers[questionKey({ index })]?.noul;
      // A question Jev left unanswered is no judgement at all, so the fuzzy score stands.
      if (typeof noul !== 'number') return [entry.id, fallbackById[entry.id] ?? 0];
      return [entry.id, Math.min(1, Math.max(0, noul))];
    }),
  );
}

/**
 * How strongly each transaction's text names the invoice's vendor, 0..1. Fuse.js answers
 * on its own; when a TypeSafe key is configured and `allowJev` is set, its Jev judgement
 * overrides every question it answered, and a failure leaves the fuzzy scores standing.
 */
export async function resolveMerchantSimilarity({
  vendorName,
  candidates,
  allowJev,
}: {
  vendorName: string;
  candidates: SimilarityCandidate[];
  /** Jev runs on the operator's TypeSafe budget, so only entitled callers may spend it. */
  allowJev: boolean;
}): Promise<{ similarityById: Record<string, number>; usedJev: boolean }> {
  const similarityById = fuseSimilarity({ vendorName, candidates });

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!allowJev || !apiKey || !isEnvConfigured(EnvVar.TYPESAFE_API_KEY, apiKey) || candidates.length === 0) {
    return { similarityById, usedJev: false };
  }

  try {
    return {
      similarityById: await jevSimilarity({ apiKey, vendorName, candidates, fallbackById: similarityById }),
      usedJev: true,
    };
  } catch (error) {
    if (error instanceof TypeSafeHttpError && (error.status === 401 || error.status === 403)) {
      logger.error('TYPESAFE_API_KEY was rejected; merchant judging falls back to fuzzy matching', {
        status: error.status,
      });
    } else {
      logger.warn('TypeSafe merchant judgement failed, keeping the fuzzy scores', { error: String(error) });
    }
    return { similarityById, usedJev: false };
  }
}
