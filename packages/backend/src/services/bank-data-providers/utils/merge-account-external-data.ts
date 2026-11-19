import { connection } from '@models/connection';

/**
 * Writes `patch` into the stored `externalData` with a jsonb merge, so keys written by
 * someone else after this caller read the account (such as `bankConnection`) survive.
 * An `undefined` value removes its key.
 */
export async function mergeAccountExternalData({
  accountId,
  patch,
}: {
  accountId: string;
  patch: Record<string, unknown> & { bankConnection?: never };
}): Promise<void> {
  const removedKeys = Object.keys(patch).filter((key) => patch[key] === undefined);

  await connection.sequelize.query(
    `UPDATE "Accounts"
        SET "externalData" = (COALESCE("externalData", '{}'::jsonb) || CAST(:patch AS jsonb)) - CAST(:removedKeys AS text[])
      WHERE "id" = :accountId`,
    { replacements: { accountId, patch: JSON.stringify(patch), removedKeys: `{${removedKeys.join(',')}}` } },
  );
}
