import { HouseholdSharePermission, RecordId, RESOURCE_TYPES } from '@bt/shared/types';
import AccountGroups from '@models/accounts-groups/account-groups.model';
import * as Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Budget from '@models/budget.model';
import Categories from '@models/categories.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Notifications from '@models/notifications.model';
import PayeeIgnoredNames from '@models/payee-ignored-names.model';
import Payees from '@models/payees.model';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionTemplates from '@models/transaction-templates.model';
import TransferSuggestionDismissals from '@models/transfer-suggestion-dismissals.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UserMerchantCategoryCodes from '@models/user-merchant-category-codes.model';
import UserSettings from '@models/user-settings.model';
import UsersCurrencies from '@models/users-currencies.model';
import * as Users from '@models/users.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { Op } from 'sequelize';

import { seedUserDefaults } from './create-user-with-defaults.service';
import { runUserDestroyLifecycle } from './user-destroy-lifecycle';

interface SharedResourceSummary {
  /** Accounts this user OWNS that another user currently has share access to. */
  accounts: Array<{ id: string; name: string; recipientUserId: number }>;
  /** Households this user OWNS with at least one accepted member. */
  households: Array<{ shareId: RecordId; recipientUserId: number; permission: HouseholdSharePermission }>;
}

/**
 * Preflight check for the wipe-data flow. Returns a summary of shared resources the user
 * OWNS where other users currently have access. UI uses this to gate the destructive
 * action behind an extra acknowledgement step — wiping their data will revoke access for
 * those other users.
 */
export const getOwnedSharedResourceSummary = async ({ userId }: { userId: number }): Promise<SharedResourceSummary> => {
  const [accountShareRows, householdShareRows] = await Promise.all([
    ResourceShares.findAll({
      where: { ownerUserId: userId, resourceType: RESOURCE_TYPES.account },
      attributes: ['resourceId', 'sharedWithUserId'],
      raw: true,
    }) as unknown as Promise<Array<{ resourceId: string; sharedWithUserId: number }>>,
    ResourceShares.findAll({
      where: {
        ownerUserId: userId,
        resourceType: RESOURCE_TYPES.household,
        acceptedAt: { [Op.not]: null },
      },
      attributes: ['id', 'sharedWithUserId', 'permission'],
      raw: true,
    }) as unknown as Promise<Array<{ id: RecordId; sharedWithUserId: number; permission: HouseholdSharePermission }>>,
  ]);

  const accountIds = [...new Set(accountShareRows.map((s) => s.resourceId))];
  const accountRows = accountIds.length
    ? ((await Accounts.default.findAll({
        where: { id: { [Op.in]: accountIds } },
        attributes: ['id', 'name'],
        raw: true,
      })) as Array<{ id: string; name: string }>)
    : [];
  const namesById = new Map(accountRows.map((a) => [a.id, a.name]));

  return {
    accounts: accountShareRows.map((s) => ({
      id: s.resourceId,
      name: namesById.get(s.resourceId) ?? 'Shared account',
      recipientUserId: s.sharedWithUserId,
    })),
    households: householdShareRows.map((s) => ({
      shareId: s.id,
      recipientUserId: s.sharedWithUserId,
      permission: s.permission,
    })),
  };
};

/**
 * Ordered destroy of everything a user OWNS, minus the reseed. Two callers:
 * wipe-data (reseeds defaults afterwards) and backup-restore (inserts the
 * backup's own tables afterwards, no reseed). Must run inside a transaction —
 * both callers invoke it from `runUserDestroyLifecycle`'s `destroyInTx` hook so
 * the surrounding spine handles share-target snapshots and notification fan-out.
 *
 * Includes the payee library (Payees + PayeeIgnoredNames) — a wipe is a clean
 * slate, so learned payees and the ignore-list go too.
 *
 * Leaves the Users + `ba_user` rows intact (identity is preserved); only the
 * domain data + per-user settings/currency state go.
 */
export const destroyUserOwnedData = async ({ user }: { user: Users.default }) => {
  // Break Users → Categories FK before the Categories rows go. The caller repoints
  // `defaultCategoryId` afterwards (reseed for wipe, restored value for backup).
  // totalBalance gets recomputed from accounts on demand; zero it as the baseline.
  await Users.default.update({ defaultCategoryId: null, totalBalance: 0 }, { where: { id: user.id } });

  // Disentangle the sharing layer first. Both directions: rows where this user is the
  // owner AND rows where this user is the recipient of someone else's share.
  await ResourceShares.destroy({
    where: { [Op.or]: [{ ownerUserId: user.id }, { sharedWithUserId: user.id }] },
  });
  await ShareInvitations.destroy({
    where: { [Op.or]: [{ ownerUserId: user.id }, { inviteeUserId: user.id }] },
  });

  // Domain-top tables. DB-level FK CASCADE handles most children:
  //   Accounts → Balances, Transactions, BankDataProviderConnections,
  //              TransactionTags, TransactionSplits, RefundTransactions
  //   Budget → BudgetCategories, BudgetTags, BudgetTransactions
  //   Subscriptions → SubscriptionPeriods → SubscriptionPeriodNotifications,
  //                   SubscriptionTransactions
  //   Portfolios → Holdings, PortfolioBalances, PortfolioTransfers, InvestmentTransaction
  //   VentureDeals → VentureEvents → VentureEventLinks
  //   TransactionGroups → TransactionGroupItems
  //   AccountGroups → AccountGrouping
  //   Tags → TagReminders (TransactionTags already gone via Accounts cascade)
  //   Payees → PayeeAliases, PayeeTags
  //   TransactionTemplates → TransactionTemplateTags
  //
  // Paranoid models (Portfolios, VentureDeals, VenturePlatforms) need `force: true`
  // or `.destroy()` only sets `deletedAt`, leaving the rows visible to subsequent
  // queries that bypass the default scope. VentureDeals.platformId is SET NULL (not
  // CASCADE) so deals must be destroyed explicitly — destroying VenturePlatforms
  // alone would leave the deals + their events behind.
  //
  // Ordering note: things that reference Accounts/Categories/Tags go BEFORE those
  // tables, so their cascades can run cleanly against still-present rows.
  await Notifications.destroy({ where: { userId: user.id } });
  await SubscriptionCandidates.destroy({ where: { userId: user.id } });
  await TransferSuggestionDismissals.destroy({ where: { userId: user.id } });
  await TransactionAutomations.destroy({ where: { userId: user.id } });
  await Budget.destroy({ where: { userId: user.id } });
  await Subscriptions.destroy({ where: { userId: user.id } });
  await TransactionTemplates.destroy({ where: { userId: user.id } });
  // PortfolioTransfers FKs Transactions / Accounts / Portfolios all via SET NULL.
  // A prior failed wipe (or any inconsistency) can leave a PT row whose transactionId
  // points at a Transaction that no longer exists. When `Accounts.destroy` below
  // cascades to Transactions, Postgres re-validates the SET NULL chain on PT and
  // trips on the dangling reference, aborting the whole wipe. Destroying PT outright
  // by userId clears both live rows and orphans before the cascade can stumble.
  await PortfolioTransfers.destroy({ where: { userId: user.id } });
  await Portfolios.destroy({ where: { userId: user.id }, force: true });
  await VentureDeals.destroy({ where: { userId: user.id }, force: true });
  await VenturePlatforms.destroy({ where: { userId: user.id }, force: true });
  await Vehicles.destroy({ where: { userId: user.id } });
  await AccountGroups.destroy({ where: { userId: user.id } });
  await TransactionGroups.destroy({ where: { userId: user.id } });
  await Accounts.default.destroy({ where: { userId: user.id } });
  // Payees go after Accounts so Transactions (cascaded above) are already gone.
  // PayeeAliases/PayeeTags CASCADE off payeeId, so destroying Payees clears
  // them too — no separate destroy needed. Payees' own FK is on Users
  // (untouched by this function), so nothing cascades it automatically.
  await Payees.destroy({ where: { userId: user.id } });
  // Independent of Payees — its own userId FK, no cascade path either way.
  await PayeeIgnoredNames.destroy({ where: { userId: user.id } });
  // UserMerchantCategoryCodes FKs Categories WITHOUT cascade — must die first or
  // the Categories DELETE below trips a FK violation and aborts the whole wipe.
  await UserMerchantCategoryCodes.destroy({ where: { userId: user.id } });
  await Tags.destroy({ where: { userId: user.id } });
  await Categories.destroy({ where: { userId: user.id } });
  await BankDataProviderConnections.destroy({ where: { userId: user.id } });

  // Per-user settings + currency state. Wiping UsersCurrencies resets base currency,
  // forcing the user to re-pick one on next session — matches the "fresh start" intent.
  await UsersCurrencies.destroy({ where: { userId: user.id } });
  await UserExchangeRates.destroy({ where: { userId: user.id } });
  await UserSettings.destroy({ where: { userId: user.id } });
};

export const wipeUserData = async ({ userId }: { userId: number }) => {
  await runUserDestroyLifecycle({
    userId,
    cacheLogPrefix: 'user-wipe',
    failureLogCode: 'USER_WIPE_FAILED',
    failureLogMessage: 'User data wipe failed',
    destroyInTx: async ({ user }) => {
      await destroyUserOwnedData({ user });

      // Reseed default categories + tags + default-category pointer. A wiped user lands
      // on the same starter state a brand-new signup would — empty-state with common
      // categories (Food, Transport, …) already populated. Runs in the same tx so a
      // mid-flight failure rolls back the whole wipe rather than leaving a half-wiped,
      // un-seeded account.
      await seedUserDefaults({ userId: user.id });
    },
  });
};
