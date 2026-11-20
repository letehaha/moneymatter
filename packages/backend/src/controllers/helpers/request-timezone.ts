import { logger } from '@js/utils/logger';
import { connection } from '@models/connection';
import { Request } from 'express';
import { QueryTypes } from 'sequelize';

const intlCanonical = ({ zone }: { zone: string }): string | null => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone.toLowerCase();
  } catch {
    return null;
  }
};

const loadPgZones = async (): Promise<Map<string, string>> => {
  const rows: { name: string }[] = await connection.sequelize.query('SELECT name FROM pg_timezone_names', {
    type: QueryTypes.SELECT,
  });
  const usable = rows.flatMap(({ name }) => {
    const canonical = intlCanonical({ zone: name });
    return canonical ? [{ name, canonical }] : [];
  });
  const zones = new Map<string, string>();
  for (const { name, canonical } of usable) zones.set(canonical, name);
  for (const { name } of usable) zones.set(name.toLowerCase(), name);
  return zones;
};

let pgZones: Promise<Map<string, string>> | null = null;

const getPgZones = () => {
  pgZones ??= loadPgZones().catch((error) => {
    pgZones = null;
    throw error;
  });
  return pgZones;
};

/**
 * The client's `X-Timezone` as a name both Postgres and Intl accept, UTC when missing or unknown.
 * Intl's canonical names can be legacy links (`Europe/Kiev`) that Postgres lacks, so the header
 * is matched against `pg_timezone_names` directly or via Intl's canonical form.
 */
export const requestTimezone = async ({ req }: { req: Request }): Promise<string> => {
  const header = req.get('X-Timezone');
  if (!header) return 'UTC';

  const zones = await getPgZones();
  const canonical = intlCanonical({ zone: header });
  const zone = zones.get(header.toLowerCase()) ?? (canonical ? zones.get(canonical) : undefined);
  if (zone) return zone;

  logger.warn('[Request timezone] Unknown X-Timezone header, using UTC', { header });
  return 'UTC';
};
