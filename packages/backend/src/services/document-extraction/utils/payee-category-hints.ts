import { getCategories } from '@models/categories.model';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import { buildHaystack } from '@services/payees/fuzzy-matcher';
import type { TextPart } from 'ai';

// ponytail: names past this cap are never offered to the AI. Rank by usage if large payee lists miss matches.
const MAX_KNOWN_ENTRIES = 1000;

export const knownListParts = ({ label, names }: { label: string; names: string[] }): TextPart[] =>
  names.length ? [{ type: 'text', text: `${label}:\n${names.slice(0, MAX_KNOWN_ENTRIES).join('\n')}` }] : [];

function findByName<T extends { text: string }>({
  entries,
  name,
}: {
  entries: T[];
  name: string | null;
}): T | undefined {
  const wanted = name?.trim().toLowerCase();
  return wanted ? entries.find((entry) => entry.text.trim().toLowerCase() === wanted) : undefined;
}

/** The user's payee and category names to offer the AI, and a resolver from its picks back to the user's ids. */
export async function loadPayeeAndCategoryMatcher({ userId }: { userId: number }) {
  const [payees, categories] = await Promise.all([
    Payees.findAll({ where: { userId }, include: [{ model: PayeeAliases, as: 'aliases' }] }),
    getCategories({ userId }),
  ]);
  const knownPayees = buildHaystack({ payees });
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const knownCategories = categories.map((category) => ({
    categoryId: category.id,
    text: [category.parentId && nameById.get(category.parentId), category.name].filter(Boolean).join(' › '),
  }));

  return {
    knownPayeeNames: knownPayees.map((entry) => entry.text),
    knownCategoryNames: knownCategories.map((entry) => entry.text),
    suggest: ({ payeeName, categoryName }: { payeeName: string | null; categoryName: string | null }) => {
      const suggestedPayeeId = findByName({ entries: knownPayees, name: payeeName })?.payeeId ?? null;
      const payeeDefaultCategoryId = payees.find((payee) => payee.id === suggestedPayeeId)?.defaultCategoryId ?? null;

      return {
        suggestedPayeeId,
        suggestedCategoryId:
          payeeDefaultCategoryId ?? findByName({ entries: knownCategories, name: categoryName })?.categoryId ?? null,
      };
    },
  };
}
