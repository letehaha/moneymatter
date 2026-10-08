import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import {
  BanknoteIcon,
  BitcoinIcon,
  CarIcon,
  CreditCardIcon,
  GiftIcon,
  HandCoinsIcon,
  LandmarkIcon,
  PiggyBankIcon,
  ShieldIcon,
  TrendingUpIcon,
  WalletIcon,
} from '@lucide/vue';
import type { Component } from 'vue';

/**
 * Single source for per-account-category icon and chip color so account list rows don't drift apart.
 * Color comes from the `--account-<color>` design tokens (see `global.css`) bridged to Tailwind as
 * `bg-account-<color>` / `text-account-<color>`, applied as a soft tinted square behind the row icon.
 */

const ACCOUNT_CATEGORY_ICONS: Record<ACCOUNT_CATEGORIES, Component> = {
  [ACCOUNT_CATEGORIES.currentAccount]: LandmarkIcon,
  [ACCOUNT_CATEGORIES.general]: WalletIcon,
  [ACCOUNT_CATEGORIES.bonus]: GiftIcon,
  [ACCOUNT_CATEGORIES.insurance]: ShieldIcon,
  [ACCOUNT_CATEGORIES.saving]: PiggyBankIcon,
  [ACCOUNT_CATEGORIES.creditCard]: CreditCardIcon,
  [ACCOUNT_CATEGORIES.overdraft]: CreditCardIcon,
  [ACCOUNT_CATEGORIES.cash]: BanknoteIcon,
  [ACCOUNT_CATEGORIES.investment]: TrendingUpIcon,
  [ACCOUNT_CATEGORIES.crypto]: BitcoinIcon,
  [ACCOUNT_CATEGORIES.vehicle]: CarIcon,
  [ACCOUNT_CATEGORIES.loan]: HandCoinsIcon,
};

type AccountColor = 'checking' | 'saving' | 'credit' | 'cash' | 'investment' | 'crypto' | 'vehicle';

const ACCOUNT_CATEGORY_COLORS: Record<ACCOUNT_CATEGORIES, AccountColor> = {
  [ACCOUNT_CATEGORIES.currentAccount]: 'checking',
  [ACCOUNT_CATEGORIES.general]: 'checking',
  [ACCOUNT_CATEGORIES.bonus]: 'checking',
  [ACCOUNT_CATEGORIES.insurance]: 'checking',
  [ACCOUNT_CATEGORIES.saving]: 'saving',
  [ACCOUNT_CATEGORIES.creditCard]: 'credit',
  [ACCOUNT_CATEGORIES.overdraft]: 'credit',
  [ACCOUNT_CATEGORIES.cash]: 'cash',
  [ACCOUNT_CATEGORIES.investment]: 'investment',
  [ACCOUNT_CATEGORIES.crypto]: 'crypto',
  [ACCOUNT_CATEGORIES.vehicle]: 'vehicle',
  [ACCOUNT_CATEGORIES.loan]: 'checking',
};

/**
 * Soft tinted square behind the account-category icon in list rows. Each entry is a full static
 * literal so Tailwind's scanner picks the classes up — never build these by string interpolation.
 */
const TINTED_CHIP_CLASSES: Record<AccountColor, string> = {
  checking: 'bg-account-checking/15 text-account-checking',
  saving: 'bg-account-saving/15 text-account-saving',
  credit: 'bg-account-credit/15 text-account-credit',
  cash: 'bg-account-cash/15 text-account-cash',
  investment: 'bg-account-investment/15 text-account-investment',
  crypto: 'bg-account-crypto/15 text-account-crypto',
  vehicle: 'bg-account-vehicle/15 text-account-vehicle',
};

/** Opaque counterpart, for a chip that overlaps other content where the tint would let it show through. */
const SOLID_CHIP_CLASSES: Record<AccountColor, string> = {
  checking: 'bg-account-checking text-background',
  saving: 'bg-account-saving text-background',
  credit: 'bg-account-credit text-background',
  cash: 'bg-account-cash text-background',
  investment: 'bg-account-investment text-background',
  crypto: 'bg-account-crypto text-background',
  vehicle: 'bg-account-vehicle text-background',
};

const getAccountColor = ({ category }: { category: ACCOUNT_CATEGORIES }): AccountColor =>
  ACCOUNT_CATEGORY_COLORS[category] ?? ACCOUNT_CATEGORY_COLORS[ACCOUNT_CATEGORIES.general];

// Fall back to `general` so an unrecognized category (e.g. new server-side value) still renders.
export const getAccountTypeIcon = ({ category }: { category: ACCOUNT_CATEGORIES }): Component =>
  ACCOUNT_CATEGORY_ICONS[category] ?? ACCOUNT_CATEGORY_ICONS[ACCOUNT_CATEGORIES.general];

export const getAccountTypeTintedChipClass = ({ category }: { category: ACCOUNT_CATEGORIES }): string =>
  TINTED_CHIP_CLASSES[getAccountColor({ category })];

export const getAccountTypeSolidChipClass = ({ category }: { category: ACCOUNT_CATEGORIES }): string =>
  SOLID_CHIP_CLASSES[getAccountColor({ category })];
