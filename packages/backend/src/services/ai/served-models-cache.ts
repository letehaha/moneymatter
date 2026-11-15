/**
 * A provider's model list, remembered briefly per connection. Checking a model pick against the list costs
 * one cheap request instead of a paid generate call, and the same list serves the next picks.
 */
export const SERVED_MODELS_TTL_MS = 10 * 60 * 1000;

/** Bounds the map for an instance with many connections; the oldest entry goes first. */
const MAX_ENTRIES = 500;

const entries = new Map<string, { models: string[]; expiresAt: number }>();

/** Only a non-empty list is kept: an empty one means no listing, or an endpoint that did not answer. */
export async function getCachedServedModels({
  key,
  load,
}: {
  key: string;
  load: () => Promise<string[]>;
}): Promise<string[]> {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const models = await load();

  if (models.length > 0) {
    entries.delete(key);
    entries.set(key, { models, expiresAt: Date.now() + SERVED_MODELS_TTL_MS });
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  } else {
    entries.delete(key);
  }

  return models;
}

export function clearServedModelsCache(): void {
  entries.clear();
}
