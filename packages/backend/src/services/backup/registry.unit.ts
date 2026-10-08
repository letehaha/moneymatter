import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/index';

import { BACKUP_EXCLUDED, BACKUP_TABLES, REFERENCE_TABLES } from './registry';

describe('backup registry drift guard', () => {
  it('every registered Sequelize model has an explicit backup decision', () => {
    // Compare by class reference: a model registered with Sequelize but absent
    // from BACKUP_TABLES / REFERENCE_TABLES / BACKUP_EXCLUDED shows up here, and
    // so does a registry entry whose model name resolved to `undefined`.
    const covered = new Set<unknown>([...BACKUP_TABLES, ...REFERENCE_TABLES, ...BACKUP_EXCLUDED].map((e) => e.model));

    const registered = Object.values(connection.sequelize.models) as { name: string }[];
    const uncovered = registered.filter((model) => !covered.has(model)).map((model) => model.name);

    expect(uncovered).toEqual([]);
  });
});
