import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type RecordId,
  type ResourceShareInfo,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { FORM_TYPES } from '../types';
import { canDuplicateTransaction } from './can-duplicate-transaction';

const createAccount = (overrides: Partial<AccountModel> = {}): AccountModel =>
  ({
    id: 'a-source' as RecordId,
    name: 'Checking',
    type: ACCOUNT_TYPES.system,
    status: ACCOUNT_STATUSES.active,
    currencyCode: 'USD',
    ...overrides,
  }) as AccountModel;

const source = createAccount();
const destination = createAccount({ id: 'a-destination' as RecordId });
const eurDestination = createAccount({ id: 'a-eur' as RecordId, currencyCode: 'EUR' });
const connected = createAccount({ id: 'a-bank' as RecordId, type: ACCOUNT_TYPES.monobank });
const sharedWith = (permission: ResourceShareInfo['permission']) =>
  createAccount({
    id: `a-shared-${permission}` as RecordId,
    share: { isOwner: false, permission } as ResourceShareInfo,
  });

type Params = Parameters<typeof canDuplicateTransaction>[0];
type FormOverrides = Partial<Params['form']>;

const build = ({ form, ...overrides }: Partial<Omit<Params, 'form'>> & { form?: FormOverrides } = {}): Params => ({
  transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
  form: { type: FORM_TYPES.transfer, account: source, toAccount: destination, isPlanned: false, ...form },
  transferDestinationType: 'account',
  hasLockedLeg: false,
  hasOppositeTransaction: true,
  sourceAccounts: [source],
  plannedAccounts: [source, connected],
  destinationAccounts: [destination, eurDestination],
  ...overrides,
});

const outOfWalletParams = ({ form }: { form: FormOverrides }) =>
  build({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet, hasOppositeTransaction: false, form });

const nonTransferParams = ({ form, ...overrides }: Partial<Omit<Params, 'form'>> & { form?: FormOverrides } = {}) =>
  build({
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    hasOppositeTransaction: false,
    form: { type: FORM_TYPES.expense, toAccount: null, ...form },
    ...overrides,
  });

describe('canDuplicateTransaction', () => {
  describe('non-transfers', () => {
    it('allows an expense on an offered account', () => {
      expect(canDuplicateTransaction(nonTransferParams())).toBe(true);
    });

    it('allows a copy on an own bank-connected account, created as a plan', () => {
      expect(canDuplicateTransaction(nonTransferParams({ form: { account: connected }, hasLockedLeg: true }))).toBe(
        true,
      );
    });

    it('rejects a bank-connected account that plans cannot target', () => {
      expect(canDuplicateTransaction(nonTransferParams({ form: { account: connected }, plannedAccounts: [] }))).toBe(
        false,
      );
    });

    it('rejects a planned copy on an account plans cannot target', () => {
      expect(canDuplicateTransaction(nonTransferParams({ form: { isPlanned: true }, plannedAccounts: [] }))).toBe(
        false,
      );
    });

    it('rejects an account the form does not offer', () => {
      expect(canDuplicateTransaction(nonTransferParams({ sourceAccounts: [] }))).toBe(false);
    });

    it('rejects a missing account and a row switched to a transfer', () => {
      expect(canDuplicateTransaction(nonTransferParams({ form: { account: null } }))).toBe(false);
      expect(canDuplicateTransaction(nonTransferParams({ form: { type: FORM_TYPES.transfer } }))).toBe(false);
    });
  });

  describe('transfers', () => {
    it('allows a plain transfer between own accounts', () => {
      expect(canDuplicateTransaction(build())).toBe(true);
    });

    it('allows a cross-currency transfer', () => {
      expect(canDuplicateTransaction(build({ form: { toAccount: eurDestination } }))).toBe(true);
    });

    it('allows a shared destination with write access', () => {
      for (const permission of [SHARE_PERMISSIONS.write, SHARE_PERMISSIONS.manage]) {
        const shared = sharedWith(permission);
        expect(canDuplicateTransaction(build({ form: { toAccount: shared }, destinationAccounts: [shared] }))).toBe(
          true,
        );
      }
    });

    it('rejects a read-only shared destination', () => {
      const readOnly = sharedWith(SHARE_PERMISSIONS.read);
      expect(canDuplicateTransaction(build({ form: { toAccount: readOnly }, destinationAccounts: [readOnly] }))).toBe(
        false,
      );
    });

    it('allows out-of-wallet transfers in either direction without an opposite leg', () => {
      expect(canDuplicateTransaction(outOfWalletParams({ form: { toAccount: OUT_OF_WALLET_ACCOUNT_MOCK } }))).toBe(
        true,
      );
      expect(canDuplicateTransaction(outOfWalletParams({ form: { account: OUT_OF_WALLET_ACCOUNT_MOCK } }))).toBe(true);
    });

    it('rejects out-of-wallet on both sides', () => {
      expect(
        canDuplicateTransaction(
          outOfWalletParams({ form: { account: OUT_OF_WALLET_ACCOUNT_MOCK, toAccount: OUT_OF_WALLET_ACCOUNT_MOCK } }),
        ),
      ).toBe(false);
    });

    it('rejects a missing account on either side', () => {
      expect(canDuplicateTransaction(build({ form: { account: null } }))).toBe(false);
      expect(canDuplicateTransaction(build({ form: { toAccount: null } }))).toBe(false);
    });

    it('rejects a common transfer whose opposite leg is missing', () => {
      expect(canDuplicateTransaction(build({ hasOppositeTransaction: false }))).toBe(false);
    });

    it('rejects a transfer with a bank-connected or linked leg', () => {
      expect(canDuplicateTransaction(build({ hasLockedLeg: true }))).toBe(false);
    });

    it('rejects accounts the Transfer tab pickers do not offer', () => {
      expect(canDuplicateTransaction(build({ sourceAccounts: [] }))).toBe(false);
      expect(canDuplicateTransaction(build({ destinationAccounts: [] }))).toBe(false);
    });

    it('rejects non-account destinations', () => {
      expect(canDuplicateTransaction(build({ transferDestinationType: 'loan' }))).toBe(false);
      expect(canDuplicateTransaction(build({ transferDestinationType: 'portfolio' }))).toBe(false);
    });

    it('rejects portfolio and loan transfer natures', () => {
      expect(
        canDuplicateTransaction(build({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio })),
      ).toBe(false);
      expect(canDuplicateTransaction(build({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan }))).toBe(
        false,
      );
      expect(canDuplicateTransaction(build({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_venture }))).toBe(
        false,
      );
      expect(canDuplicateTransaction(build({ transferNature: undefined }))).toBe(false);
    });

    it('rejects a row switched off the Transfer tab', () => {
      expect(canDuplicateTransaction(build({ form: { type: FORM_TYPES.expense } }))).toBe(false);
    });

    it('rejects an out-of-wallet transfer with a locked leg', () => {
      expect(
        canDuplicateTransaction({
          ...outOfWalletParams({ form: { toAccount: OUT_OF_WALLET_ACCOUNT_MOCK } }),
          hasLockedLeg: true,
        }),
      ).toBe(false);
    });

    it('rejects an out-of-wallet transfer with a non-account destination', () => {
      expect(
        canDuplicateTransaction({
          ...outOfWalletParams({ form: { toAccount: OUT_OF_WALLET_ACCOUNT_MOCK } }),
          transferDestinationType: 'portfolio',
        }),
      ).toBe(false);
    });
  });
});
