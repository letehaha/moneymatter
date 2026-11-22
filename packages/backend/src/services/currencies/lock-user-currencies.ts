import { connection } from '@models/connection';

// ponytail: no unique index on (userId, currencyCode); a unique index + dedupe migration would make this lock unnecessary
export const lockUserCurrencies = async ({ userId }: { userId: number }) => {
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('users-currencies'), :userId)`, {
    replacements: { userId },
  });
};
