import { CategoryModel, TRIAL_DAYS } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { connection } from '@models/index';
import SignupLedger from '@models/signup-ledger.model';
import Tags from '@models/tags.model';
import Users from '@models/users.model';
import * as userService from '@services/user.service';
import { hashEmail } from '@services/user/signups-open.service';
import { asUser, extractCookies, makeAuthRequest, makeRequest, withSelfHost } from '@tests/helpers';

/**
 * Signup-flow integration tests.
 *
 * Covers the after-hook contract end-to-end (better-auth → app `Users`):
 *   - Username slugification + collision retry
 *   - Full-name parsing into firstName / middleName / lastName
 *   - Stage-1 (app-user creation) failure → rollback orphan ba_user, propagate error
 *   - Stage-2 (default seeding) failure → keep usable account, return 200
 *
 * Note: better-auth is mocked due to ESM compatibility issues with Jest;
 * the mock now persists `ba_user` rows so rollback paths are exercised.
 */
describe('Signup flow', () => {
  describe('Username uniqueness', () => {
    it('should persist a different username when colliding with an existing one', async () => {
      // Default test user is 'test1'. A new signup using the same name must
      // succeed AND the underlying app user row must have a different,
      // unique username (the random-suffix retry path).
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'collide-1@test.local',
          password: 'password123',
          name: 'test1',
        },
      });

      expect(res.statusCode).toEqual(200);

      const newAuthUserId = res.body.user?.id;
      expect(newAuthUserId).toBeDefined();

      const newAppUser = await Users.findOne({ where: { authUserId: newAuthUserId }, raw: true });
      expect(newAppUser).not.toBeNull();
      expect(newAppUser!.username).not.toEqual('test1');
      expect(newAppUser!.username).toMatch(/^test1-[0-9a-f]{8}$/);

      const originalUser = await Users.findOne({ where: { username: 'test1' }, raw: true });
      expect(originalUser).not.toBeNull();
      expect(originalUser!.authUserId).toEqual('test-user-id');

      // The username-collision retry must leave exactly one Users row per authUserId;
      // the rejected first insert must not stay half-committed.
      const matches = await Users.findAll({ where: { authUserId: newAuthUserId }, raw: true });
      expect(matches).toHaveLength(1);
    });

    it('should produce distinct usernames across multiple consecutive collisions', async () => {
      const baseName = 'test1';
      const usernames: string[] = [];

      for (let i = 0; i < 3; i++) {
        const res = await makeAuthRequest({
          method: 'post',
          url: '/auth/sign-up/email',
          payload: {
            email: `multi-collide-${i}@test.local`,
            password: 'password123',
            name: baseName,
          },
        });

        expect(res.statusCode).toEqual(200);
        const authUserId = res.body.user?.id;
        const appUser = await Users.findOne({ where: { authUserId }, raw: true });
        expect(appUser).not.toBeNull();
        usernames.push(appUser!.username);
      }

      const unique = new Set([...usernames, baseName]);
      expect(unique.size).toEqual(4);
      usernames.forEach((u) => expect(u).toMatch(/^test1-[0-9a-f]{8}$/));
    });

    it('should fall back to email prefix for username AND leave name fields null when name is empty', async () => {
      // The hook fallback chain for username is: user.name || user.email.split('@')[0] || 'user'.
      // An empty `name` must trigger the email-prefix branch for the username,
      // BUT must not be passed to fullName parsing — email-prefix fallbacks
      // aren't real names and shouldn't pollute firstName/middleName/lastName.
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'fallback-user@test.local',
          password: 'password123',
          name: '',
        },
      });

      expect(res.statusCode).toEqual(200);
      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      expect(appUser!.username).toMatch(/^fallback-user(-[0-9a-f]{8})?$/);
      expect(appUser!.firstName).toBeNull();
      expect(appUser!.middleName).toBeNull();
      expect(appUser!.lastName).toBeNull();
    });

    it('should treat a whitespace-only name as missing and fall through to the email-prefix branch', async () => {
      // Without trimming at the source, "   " is truthy in JS and would skip
      // the email-prefix fallback, yielding the generic "user" slug. The hook
      // trims so the email prefix is preferred over a meaningless fallback.
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'whitespace-only@test.local',
          password: 'password123',
          name: '   ',
        },
      });

      expect(res.statusCode).toEqual(200);
      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      expect(appUser!.username).toMatch(/^whitespace-only(-[0-9a-f]{8})?$/);
      expect(appUser!.firstName).toBeNull();
      expect(appUser!.middleName).toBeNull();
      expect(appUser!.lastName).toBeNull();
    });

    it('should trim leading/trailing whitespace before slugifying and parsing the name', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'padded-name@test.local',
          password: 'password123',
          name: '   Felix Ironwood   ',
        },
      });

      expect(res.statusCode).toEqual(200);
      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      expect(appUser!.username).toEqual('felix-ironwood');
      expect(appUser!.firstName).toEqual('Felix');
      expect(appUser!.lastName).toEqual('Ironwood');
    });
  });

  describe('Slugify on signup', () => {
    it('should slugify the input name (lowercase + hyphenated) before storing', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'slug-mixed@test.local',
          password: 'password123',
          name: 'John Doe Smith',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      expect(appUser!.username).toEqual('john-doe-smith');
    });

    it('should strip special characters and trailing whitespace from the name', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'slug-special@test.local',
          password: 'password123',
          name: '  Foo. Bar!  ',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser!.username).toEqual('foo-bar');
    });

    it('should produce a case-insensitive collision when "John" and "john" both sign up', async () => {
      // Both names slugify to "john" — first wins, second gets the suffix.
      const first = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: { email: 'case-1@test.local', password: 'password123', name: 'John' },
      });
      expect(first.statusCode).toEqual(200);

      const second = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: { email: 'case-2@test.local', password: 'password123', name: 'john' },
      });
      expect(second.statusCode).toEqual(200);

      const firstAppUser = await Users.findOne({ where: { authUserId: first.body.user.id }, raw: true });
      const secondAppUser = await Users.findOne({ where: { authUserId: second.body.user.id }, raw: true });

      expect(firstAppUser!.username).toEqual('john');
      expect(secondAppUser!.username).toMatch(/^john-[0-9a-f]{8}$/);
    });

    it('should fall back to "user" when the name slugifies to empty (e.g., emoji-only)', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'slug-emoji@test.local',
          password: 'password123',
          name: '🎉🚀',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      // First user with all-non-Latin name claims literal "user", subsequent
      // ones get the suffix retry. Either is acceptable here.
      expect(appUser!.username).toMatch(/^user(-[0-9a-f]{8})?$/);
    });

    it('should cap an extremely long name at the slug length limit', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'slug-long@test.local',
          password: 'password123',
          name: 'a'.repeat(300),
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
      expect(appUser!.username.length).toBeLessThanOrEqual(64);
    });
  });

  describe('Name parsing on signup', () => {
    it('should parse a two-token name into firstName + lastName', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'parse-two@test.local',
          password: 'password123',
          name: 'Wendy Marlow',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser!.username).toEqual('wendy-marlow');
      expect(appUser!.firstName).toEqual('Wendy');
      expect(appUser!.lastName).toEqual('Marlow');
      expect(appUser!.middleName).toBeNull();
    });

    it('should parse a three-token name into firstName + middleName + lastName', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'parse-three@test.local',
          password: 'password123',
          name: 'Caspian Reed Holloway',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser!.firstName).toEqual('Caspian');
      expect(appUser!.middleName).toEqual('Reed');
      expect(appUser!.lastName).toEqual('Holloway');
    });

    it('should put a single-token name into firstName only', async () => {
      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'parse-single@test.local',
          password: 'password123',
          name: 'Marigold',
        },
      });
      expect(res.statusCode).toEqual(200);

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser!.firstName).toEqual('Marigold');
      expect(appUser!.lastName).toBeNull();
      expect(appUser!.middleName).toBeNull();
    });
  });

  describe('Stage-1: app-user creation failure (rollback)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.SYSTEM_MAX_SIGNUPS_ALLOWED;
    });

    it('should rollback ba_user when app-user creation fails so signup can be retried', async () => {
      // Better-auth commits ba_user BEFORE firing the after-hook. If app-user
      // creation fails, the auth account is already committed but there's no
      // matching app user — the user can't retry signup (email taken) and
      // can't use the app (no app user → 401 "User not found"). Permanent
      // lockout.
      //
      // Fix: on app-user-creation failure, delete the orphaned ba_user
      // (which cascades to ba_account/ba_session) and propagate the error.
      // The user sees a 5xx, the email is freed, and they can retry.
      //
      // To simulate failure deterministically (since slugify now caps the
      // input length and the DB rejects nothing for normal inputs), we spy
      // on userService.createUser and force it to reject.
      const spy = jest
        .spyOn(userService, 'createUser')
        .mockRejectedValue(new Error('forced failure for rollback test'));

      const email = 'rollback-target@test.local';

      // Suite setup holds one ledger row, so a cap of 2 leaves exactly one free slot:
      // it must survive a failed signup.
      process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '2';
      const ledgerBefore = await SignupLedger.count();

      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email,
          password: 'password123',
          name: 'rollback-target',
        },
      });

      expect(res.statusCode).not.toEqual(200);
      expect(spy).toHaveBeenCalled();

      const [orphans] = (await connection.sequelize.query(`SELECT id FROM ba_user WHERE email = :email`, {
        replacements: { email },
      })) as [Array<{ id: string }>, unknown];
      expect(orphans).toHaveLength(0);

      const appUsers = await Users.findAll({ where: { username: 'rollback-target' }, raw: true });
      expect(appUsers).toHaveLength(0);

      expect(await SignupLedger.count()).toEqual(ledgerBefore);
      expect(await makeRequest({ method: 'get', url: '/auth/signups-open', raw: true })).toEqual({
        signupsOpen: true,
      });
    });
  });

  describe('Stage-2: seeding failure (keep usable account)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should still return 200 and keep the app user', async () => {
      // Stage-2 contract: once the app user row exists, the user can sign
      // in and use the app even if categories/tags seeding fails. Locking
      // them out for a best-effort seeding failure would be worse than
      // the partial state.
      // Spy on the underlying model's bulkCreate (the barrel export at
      // `@services/tags` produces non-configurable namespace properties
      // that jest.spyOn can't replace).
      const spy = jest.spyOn(Tags, 'bulkCreate').mockRejectedValue(new Error('forced seed failure for test'));

      const res = await makeAuthRequest({
        method: 'post',
        url: '/auth/sign-up/email',
        payload: {
          email: 'partial-seed@test.local',
          password: 'password123',
          name: 'partial-seed-user',
        },
      });

      expect(res.statusCode).toEqual(200);
      expect(spy).toHaveBeenCalled();

      const appUser = await Users.findOne({ where: { authUserId: res.body.user.id }, raw: true });
      expect(appUser).not.toBeNull();
    });
  });
});

describe('Locale-aware signup', () => {
  /**
   * Helper to create a new user via signup endpoint with specific locale.
   * Returns the session cookies for the new user.
   */
  async function signupWithLocale({ email, locale }: { email: string; locale: string }): Promise<string> {
    const signupRes = await makeAuthRequest({
      method: 'post',
      url: '/auth/sign-up/email',
      payload: {
        email,
        password: 'testpassword123',
        name: `Test User ${locale}`,
      },
      headers: {
        'Accept-Language': locale,
      },
    });

    expect(signupRes.statusCode).toEqual(200);

    return extractCookies(signupRes);
  }

  /**
   * Helper to get categories for a specific user session.
   */
  async function getCategoriesForSession({ cookies }: { cookies: string }): Promise<CategoryModel[]> {
    const originalCookies = global.APP_AUTH_COOKIES;
    global.APP_AUTH_COOKIES = cookies;

    try {
      const result = await makeRequest<CategoryModel[], true>({
        method: 'get',
        url: '/categories',
        raw: true,
      });
      return result;
    } finally {
      global.APP_AUTH_COOKIES = originalCookies;
    }
  }

  function assertNoNamesAreI18nPaths(categories: CategoryModel[]) {
    for (const cat of categories) {
      expect(cat.name).toBeTruthy();
      expect(cat.name.startsWith('defaultCategories.')).toBe(false);
    }
  }

  /**
   * Canonical set of keys expected on every fresh user, regardless of locale.
   * Hardcoded here as an independent reference — if the seed structure in
   * `default-categories.ts` changes, this set must be updated explicitly. That
   * coupling is intentional: it forces a test review whenever the canonical key
   * set shifts.
   */
  const EXPECTED_MAIN_KEYS = new Set([
    'food',
    'shopping',
    'housing',
    'transportation',
    'vehicle',
    'life',
    'communication',
    'financial-expenses',
    'investments',
    'income',
    'other',
  ]);

  /** Composite (parentKey, key) — subcategory keys aren't globally unique
   *  (e.g. 'lottery-gambling' appears under both `life` and `income`). */
  const EXPECTED_SUBCATEGORY_KEYS = new Set([
    'food/groceries',
    'food/restaurant',
    'food/bar-cafe',
    'shopping/clothes-shoes',
    'shopping/jewels-accessories',
    'shopping/health-beauty',
    'shopping/kids',
    'shopping/home-garden',
    'shopping/pets-animals',
    'shopping/electronics-accessories',
    'shopping/stationery-tools',
    'shopping/free-time',
    'shopping/drugstore-chemist',
    'housing/rent',
    'housing/mortgage',
    'housing/energy-utilities',
    'housing/services',
    'housing/maintenance-repairs',
    'housing/property-insurance',
    'transportation/public-transport',
    'transportation/taxi',
    'transportation/long-distance',
    'transportation/business-trips',
    'vehicle/fuel',
    'vehicle/parking',
    'vehicle/vehicle-maintenance',
    'vehicle/rentals',
    'vehicle/vehicle-insurance',
    'vehicle/leasing',
    'life/health-care-doctor',
    'life/wellness-beauty',
    'life/active-sport-fitness',
    'life/culture-sport-events',
    'life/hobbies',
    'life/education-development',
    'life/books-audio-subscriptions',
    'life/tv-streaming',
    'life/holiday-trips-hotels',
    'life/gifts',
    'life/charity',
    'life/alcohol-tobacco',
    'life/lottery-gambling',
    'communication/phone-cell-phone',
    'communication/internet',
    'communication/software-apps-games',
    'communication/postal-services',
    'financial-expenses/taxes',
    'financial-expenses/insurances',
    'financial-expenses/loan-interests',
    'financial-expenses/fines',
    'financial-expenses/advisory',
    'financial-expenses/charges-fees',
    'financial-expenses/child-support',
    'investments/realty',
    'investments/vehicles-chattels',
    'investments/financial-investments',
    'investments/savings',
    'investments/collections',
    'income/wage-invoices',
    'income/interests-dividends',
    'income/sale',
    'income/rental-income',
    'income/dues-grants',
    'income/lending-renting',
    'income/checks-coupons',
    'income/lottery-gambling',
    'income/refunds',
    'income/freelance',
    'income/gifts',
  ]);

  const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

  /**
   * Asserts that the user's seeded categories all carry valid `key` values matching
   * the canonical kebab-case set. Locale-independent — names differ per locale but
   * keys are the same identifier.
   */
  function assertKeysAreCanonicalAndKebab(categories: CategoryModel[]) {
    const main = categories.filter((c) => c.parentId === null);
    const subs = categories.filter((c) => c.parentId !== null);

    for (const cat of categories) {
      expect(cat.key).toBeTruthy();
      expect(cat.key).toMatch(KEBAB_CASE_RE);
    }

    const mainKeysSeen = new Set(main.map((c) => c.key as string));
    expect(mainKeysSeen).toEqual(EXPECTED_MAIN_KEYS);

    const idToKey = new Map<string, string>();
    for (const cat of main) idToKey.set(cat.id, cat.key as string);

    const subKeysSeen = new Set(subs.map((c) => `${idToKey.get(c.parentId as string) ?? '?'}/${c.key}`));
    expect(subKeysSeen).toEqual(EXPECTED_SUBCATEGORY_KEYS);
  }

  it('seeds English category names and canonical keys when Accept-Language is en', async () => {
    const cookies = await signupWithLocale({ email: `en-test-${Date.now()}@test.local`, locale: 'en' });
    const categories = await getCategoriesForSession({ cookies });

    const mainCategoryNames = categories.filter((c) => c.parentId === null).map((c) => c.name);
    expect(mainCategoryNames).toContain('Food & Drinks');
    expect(mainCategoryNames).toContain('Shopping');
    expect(mainCategoryNames).toContain('Housing');
    expect(mainCategoryNames).toContain('Other');
    expect(mainCategoryNames).toContain('Income');

    const allCategoryNames = categories.map((c) => c.name);
    expect(allCategoryNames).toContain('Groceries');
    expect(allCategoryNames).toContain('Restaurant, fast-food');

    assertKeysAreCanonicalAndKebab(categories);
    assertNoNamesAreI18nPaths(categories);
  });

  it('seeds Ukrainian category names and canonical keys when Accept-Language is uk', async () => {
    const cookies = await signupWithLocale({ email: `uk-test-${Date.now()}@test.local`, locale: 'uk' });
    const categories = await getCategoriesForSession({ cookies });

    const mainCategoryNames = categories.filter((c) => c.parentId === null).map((c) => c.name);
    expect(mainCategoryNames).toContain('Їжа та напої');
    expect(mainCategoryNames).toContain('Покупки');
    expect(mainCategoryNames).toContain('Житло');
    expect(mainCategoryNames).toContain('Інше');
    expect(mainCategoryNames).toContain('Дохід');

    const allCategoryNames = categories.map((c) => c.name);
    expect(allCategoryNames).toContain('Продукти');
    expect(allCategoryNames).toContain('Ресторан, фаст-фуд');

    assertKeysAreCanonicalAndKebab(categories);
    assertNoNamesAreI18nPaths(categories);
  });

  it('should create English category names when Accept-Language is unsupported', async () => {
    const cookies = await signupWithLocale({ email: `ja-test-${Date.now()}@test.local`, locale: 'ja' });
    const categories = await getCategoriesForSession({ cookies });

    const mainCategoryNames = categories.filter((c) => c.parentId === null).map((c) => c.name);

    expect(mainCategoryNames).toContain('Food & Drinks');
    expect(mainCategoryNames).toContain('Shopping');
    expect(mainCategoryNames).toContain('Other');

    expect(mainCategoryNames).not.toContain('Їжа та напої');
    expect(mainCategoryNames).not.toContain('Інше');
  });
});

/** Suite setup inserts one ba_user, so a cap of 1 means the instance is already full. */
describe('Signup cap (SYSTEM_MAX_SIGNUPS_ALLOWED)', () => {
  afterEach(() => {
    delete process.env.SYSTEM_MAX_SIGNUPS_ALLOWED;
  });

  const trySignup = () =>
    makeAuthRequest({
      method: 'post',
      url: '/auth/sign-up/email',
      payload: {
        email: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
        password: 'testpassword123',
        name: 'Cap Test',
      },
    });

  it('unset: signups open and signup succeeds', async () => {
    const status = await makeRequest({ method: 'get', url: '/auth/signups-open', raw: true });
    expect(status).toEqual({ signupsOpen: true });

    const res = await trySignup();
    expect(res.statusCode).toBe(200);
  });

  it('at the limit: signups closed and signup rejected', async () => {
    process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '1';

    const status = await makeRequest({ method: 'get', url: '/auth/signups-open', raw: true });
    expect(status).toEqual({ signupsOpen: false });

    const res = await trySignup();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('SIGNUPS_DISABLED');
  });

  it('under the limit: signup succeeds and closes once the slot is taken', async () => {
    process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '2';

    const res = await trySignup();
    expect(res.statusCode).toBe(200);

    const status = await makeRequest({
      method: 'get',
      url: '/auth/signups-open',
      raw: true,
    });
    expect(status).toEqual({ signupsOpen: false });
  });

  it('self-host counts live users, so raising the cap reopens signups', async () => {
    await withSelfHost(async () => {
      // One `ba_user` exists: the seeded test account.
      process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '1';
      const closed = await makeRequest({ method: 'get', url: '/auth/signups-open', raw: true });
      expect(closed).toEqual({ signupsOpen: false });

      process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '2';
      const open = await makeRequest({ method: 'get', url: '/auth/signups-open', raw: true });
      expect(open).toEqual({ signupsOpen: true });

      const res = await trySignup();
      expect(res.statusCode).toBe(200);
    });
  });

  it('counts the ledger, so deleting the account does not reopen the slot', async () => {
    process.env.SYSTEM_MAX_SIGNUPS_ALLOWED = '2';

    const res = await trySignup();
    expect(res.statusCode).toBe(200);

    const deletion = await asUser({
      cookies: extractCookies(res),
      fn: () => makeRequest({ method: 'delete', url: '/user/delete' }),
    });
    expect(deletion.statusCode).toBe(200);

    const status = await makeRequest({
      method: 'get',
      url: '/auth/signups-open',
      raw: true,
    });
    expect(status).toEqual({ signupsOpen: false });
  });
});

describe('Trial on signup', () => {
  const signUp = ({ email }: { email: string }) =>
    makeAuthRequest({
      method: 'post',
      url: '/auth/sign-up/email',
      payload: { email, password: 'testpassword123', name: 'Trial User' },
    });

  const readTrialEndsAt = ({ cookies }: { cookies: string }) =>
    asUser({
      cookies,
      fn: async () => (await makeRequest({ method: 'get', url: '/user', raw: true })).entitlements.trialEndsAt,
    });

  it('gives a cloud signup a trial that ends in TRIAL_DAYS days', async () => {
    const res = await signUp({ email: `trial-cloud-${Date.now()}@test.local` });
    expect(res.statusCode).toEqual(200);

    const trialEndsAt = await readTrialEndsAt({ cookies: extractCookies(res) });
    expect(trialEndsAt).toBeTruthy();

    const daysLeft = (new Date(trialEndsAt!).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(TRIAL_DAYS - 1);
    expect(daysLeft).toBeLessThanOrEqual(TRIAL_DAYS);
  });

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BACKDATED_DAYS = 30;

  /** Ages the ledger anchor so a resumed trial is measurably shorter than a fresh one. */
  const backdateFirstSeen = ({ email }: { email: string }) =>
    SignupLedger.update(
      { firstSeenAt: new Date(Date.now() - BACKDATED_DAYS * DAY_MS) },
      { where: { emailHash: hashEmail({ email }) } },
    );

  const expectDaysLeft = ({ trialEndsAt, days }: { trialEndsAt: string | null; days: number }) => {
    expect(trialEndsAt).toBeTruthy();
    const daysLeft = (new Date(trialEndsAt!).getTime() - Date.now()) / DAY_MS;
    expect(daysLeft).toBeGreaterThan(days - 1 / 24);
    expect(daysLeft).toBeLessThan(days + 1 / 24);
  };

  it('resumes the original trial window when the same email signs up again', async () => {
    const email = `trial-resume-${Date.now()}@test.local`;

    const first = await signUp({ email });
    expect(first.statusCode).toEqual(200);
    const firstCookies = extractCookies(first);
    expectDaysLeft({ trialEndsAt: await readTrialEndsAt({ cookies: firstCookies }), days: TRIAL_DAYS });

    const deletion = await asUser({
      cookies: firstCookies,
      fn: () => makeRequest({ method: 'delete', url: '/user/delete' }),
    });
    expect(deletion.statusCode).toBe(200);

    await backdateFirstSeen({ email });

    const second = await signUp({ email });
    expect(second.statusCode).toEqual(200);
    expectDaysLeft({
      trialEndsAt: await readTrialEndsAt({ cookies: extractCookies(second) }),
      days: TRIAL_DAYS - BACKDATED_DAYS,
    });
  });

  it('treats a gmail dot/plus variant as the same email for the trial window', async () => {
    const stamp = Date.now();
    const email = `trial.alias.${stamp}@gmail.com`;
    const alias = `trialalias${stamp}+dup@gmail.com`;

    const first = await signUp({ email });
    expect(first.statusCode).toEqual(200);
    expectDaysLeft({ trialEndsAt: await readTrialEndsAt({ cookies: extractCookies(first) }), days: TRIAL_DAYS });

    await backdateFirstSeen({ email });

    const second = await signUp({ email: alias });
    expect(second.statusCode).toEqual(200);
    expectDaysLeft({
      trialEndsAt: await readTrialEndsAt({ cookies: extractCookies(second) }),
      days: TRIAL_DAYS - BACKDATED_DAYS,
    });
  });

  it('gives a self-hosted signup no trial at all', async () => {
    const res = await withSelfHost(() => signUp({ email: `trial-selfhost-${Date.now()}@test.local` }));
    expect(res.statusCode).toEqual(200);

    expect(await readTrialEndsAt({ cookies: extractCookies(res) })).toBeNull();
  });
});
