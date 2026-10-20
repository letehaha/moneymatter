import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BrandLogos from '@models/brand-logos.model';
import { PNG_1X1_DATA_URL } from '@tests/fixtures/logo-images';
import * as helpers from '@tests/helpers';

async function findGroupInList({ id }: { id: string }) {
  const groups = await helpers.getAccountGroups({ raw: true });
  return groups.find((group) => group.id === id);
}

describe('Create account group', () => {
  const groupName = 'Test group';

  it('successfully creates accounts group', async () => {
    await helpers.createAccountGroup({
      name: groupName,
      raw: true,
    });

    const response = await helpers.getAccountGroups({ raw: true });

    expect(response.length).toBe(1);
    expect(!!response.find((i) => i.name === groupName)).toBe(true);
  });

  it('cannot create accounts group with the same name', async () => {
    await helpers.createAccountGroup({
      name: groupName,
      raw: true,
    });
    await helpers.createAccountGroup({
      name: groupName,
    });

    const response = await helpers.getAccountGroups({ raw: true });

    expect(response.length).toBe(2);
  });

  it('successfully creates with parent group of deep nesting with several children', async () => {
    const level1 = await helpers.createAccountGroup({
      name: 'level-1',
      raw: true,
    });

    const level2 = await helpers.createAccountGroup({
      name: 'level-2',
      parentGroupId: level1.id,
      raw: true,
    });

    await helpers.createAccountGroup({
      name: 'level-3-1',
      parentGroupId: level2.id,
    });

    await helpers.createAccountGroup({
      name: 'level-3-2',
      parentGroupId: level2.id,
    });

    const response = await helpers.getAccountGroups({ raw: true });

    expect(response.length).toBe(4);
  });

  it('fails when non-existent parentGroupId provided', async () => {
    const response = await helpers.createAccountGroup({
      name: 'level-1',
      parentGroupId: generateRandomRecordId(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when user B creates a group parented under user A's group", async () => {
    const userAGroup = await helpers.createAccountGroup({
      name: 'userA-group',
      raw: true,
    });

    const userB = await helpers.provisionSecondUserWithBaseCurrency();

    const res = await helpers.asUser({
      cookies: userB.cookies,
      fn: () =>
        helpers.createAccountGroup({
          name: 'userB-group',
          parentGroupId: userAGroup.id,
        }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Update account group', () => {
  const defaultName = 'Test group';

  it('successfully updates record', async () => {
    const newName = 'test-1';
    const group = await helpers.createAccountGroup({
      name: defaultName,
      raw: true,
    });

    const result = await helpers.updateAccountGroup({
      name: newName,
      groupId: group.id,
      raw: true,
    });

    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe(newName);

    const response = await helpers.getAccountGroups({ raw: true });

    expect(response.length).toBe(1);
    expect(response.find((i) => i.name === defaultName)).toBe(undefined);
    expect(!!response.find((i) => i.name === newName)).toBe(true);
  });

  it('fails when tries to update unexisting record', async () => {
    const response = await helpers.updateAccountGroup({
      name: 'foo',
      groupId: generateRandomRecordId(),
    });

    expect(response.statusCode).toBe(404);
  });

  it('updates both name and parent group', async () => {
    const root_1 = await helpers.createAccountGroup({
      name: 'level-1',
      raw: true,
    });
    const group = await helpers.createAccountGroup({
      name: defaultName,
      raw: true,
    });

    const newName = 'test-1';
    const updation_1 = await helpers.updateAccountGroup({
      name: newName,
      parentGroupId: root_1.id,
      groupId: group.id,
      raw: true,
    });

    expect(updation_1.length).toBe(1);
    expect(updation_1[0]!.name).toBe(newName);
    expect(updation_1[0]!.parentGroupId).toBe(root_1.id);

    const root_2 = await helpers.createAccountGroup({
      name: 'level-1-2',
      raw: true,
    });
    const updation_2 = await helpers.updateAccountGroup({
      parentGroupId: root_2.id,
      groupId: group.id,
      raw: true,
    });

    expect(updation_2.length).toBe(1);
    expect(updation_2[0]!.name).toBe(newName);
    expect(updation_2[0]!.parentGroupId).toBe(root_2.id);

    const response = await helpers.getAccountGroups({ raw: true });

    expect(response.length).toBe(3);
  });

  it('sucessfully sets new name that is already connected to another group', async () => {
    const newName = 'test-1';
    await helpers.createAccountGroup({
      name: newName,
      raw: true,
    });
    const group = await helpers.createAccountGroup({
      name: defaultName,
      raw: true,
    });

    const updation = await helpers.updateAccountGroup({
      name: newName,
      groupId: group.id,
    });

    expect(updation.statusCode).toBe(200);
  });

  it('fails when tries to update to unexisting parentGroup', async () => {
    const group = await helpers.createAccountGroup({
      name: defaultName,
      raw: true,
    });

    const updation = await helpers.updateAccountGroup({
      name: 'test1',
      parentGroupId: generateRandomRecordId(),
      groupId: group.id,
    });

    expect(updation.statusCode).toBe(404);
  });

  it("returns 404 when user B tries to update user A's group", async () => {
    const userAGroup = await helpers.createAccountGroup({
      name: defaultName,
      logoDomain: 'owned.com',
      raw: true,
    });

    const userB = await helpers.provisionSecondUserWithBaseCurrency();

    const res = await helpers.asUser({
      cookies: userB.cookies,
      fn: () =>
        helpers.updateAccountGroup({
          groupId: userAGroup.id,
          name: 'hacked',
          logoDomain: 'hijack.com',
        }),
    });

    expect(res.statusCode).toBe(404);

    // The foreign PUT is blocked: the owner's group is unchanged.
    const after = await findGroupInList({ id: userAGroup.id });
    expect(after?.name).toBe(defaultName);
    expect(after?.logoDomain).toBe('owned.com');
  });

  it("returns 404 when user B tries to reparent their group under user A's group", async () => {
    const userAGroup = await helpers.createAccountGroup({
      name: defaultName,
      raw: true,
    });

    const userB = await helpers.provisionSecondUserWithBaseCurrency();
    const userBGroup = await helpers.asUser({
      cookies: userB.cookies,
      fn: () => helpers.createAccountGroup({ name: 'userB-group', raw: true }),
    });

    const res = await helpers.asUser({
      cookies: userB.cookies,
      fn: () =>
        helpers.updateAccountGroup({
          groupId: userBGroup.id,
          parentGroupId: userAGroup.id,
        }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('Delete account group', () => {
  it('successfully deletes record', async () => {
    const group = await helpers.createAccountGroup({
      name: 'test',
      raw: true,
    });

    const result = await helpers.deleteAccountGroup({
      groupId: group.id,
    });

    expect(result.statusCode).toBe(200);
  });
  it('returns successful response for non-existing record deletion', async () => {
    const result = await helpers.deleteAccountGroup({
      groupId: generateRandomRecordId(),
    });

    expect(result.statusCode).toBe(200);
  });

  it("moves the deleted group's subgroups up to its own parent", async () => {
    const root = await helpers.createAccountGroup({ name: 'root', raw: true });
    const middle = await helpers.createAccountGroup({
      name: 'middle',
      parentGroupId: root.id,
      raw: true,
    });
    const leaf = await helpers.createAccountGroup({
      name: 'leaf',
      parentGroupId: middle.id,
      raw: true,
    });

    const result = await helpers.deleteAccountGroup({ groupId: middle.id });

    expect(result.statusCode).toBe(200);
    expect(await findGroupInList({ id: middle.id })).toBeUndefined();
    expect((await findGroupInList({ id: leaf.id }))?.parentGroupId).toBe(root.id);
  });

  it('makes subgroups of a deleted root group top-level', async () => {
    const root = await helpers.createAccountGroup({ name: 'root', raw: true });
    const child = await helpers.createAccountGroup({
      name: 'child',
      parentGroupId: root.id,
      raw: true,
    });

    const result = await helpers.deleteAccountGroup({ groupId: root.id });

    expect(result.statusCode).toBe(200);
    expect((await findGroupInList({ id: child.id }))?.parentGroupId).toBeNull();
  });
});

describe('Account group parent cycles', () => {
  it('rejects setting a group as its own parent', async () => {
    const group = await helpers.createAccountGroup({
      name: 'group',
      raw: true,
    });

    const update = await helpers.updateAccountGroup({
      groupId: group.id,
      parentGroupId: group.id,
    });
    const move = await helpers.moveAccountGroup({
      groupId: group.id,
      newParentGroupId: group.id,
    });

    expect(update.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(move.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await findGroupInList({ id: group.id }))?.parentGroupId).toBeNull();
  });

  it('rejects moving a group under one of its own descendants', async () => {
    const root = await helpers.createAccountGroup({ name: 'root', raw: true });
    const middle = await helpers.createAccountGroup({
      name: 'middle',
      parentGroupId: root.id,
      raw: true,
    });
    const leaf = await helpers.createAccountGroup({
      name: 'leaf',
      parentGroupId: middle.id,
      raw: true,
    });

    const update = await helpers.updateAccountGroup({
      groupId: root.id,
      parentGroupId: leaf.id,
    });
    const move = await helpers.moveAccountGroup({
      groupId: root.id,
      newParentGroupId: leaf.id,
    });

    expect(update.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(move.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await findGroupInList({ id: root.id }))?.parentGroupId).toBeNull();
  });

  it('still allows moving a group under a non-descendant', async () => {
    const a = await helpers.createAccountGroup({ name: 'a', raw: true });
    const b = await helpers.createAccountGroup({ name: 'b', raw: true });
    const bChild = await helpers.createAccountGroup({
      name: 'b-child',
      parentGroupId: b.id,
      raw: true,
    });

    const moved = await helpers.moveAccountGroup({
      groupId: a.id,
      newParentGroupId: bChild.id,
      raw: true,
    });

    expect(moved.parentGroupId).toBe(bChild.id);
  });
});

// ---------------------------------------------------------------------------
// POST /api/account-group – logo fields at creation time
//
// Groups have no logo resolution: their generic folder names ("Cash", "Family")
// would make brand search assign wrong logos. Every logo a group carries was
// picked by the user, so there is no logoSource column to record an origin.
// ---------------------------------------------------------------------------

describe('AccountGroup POST logo', () => {
  describe('POST /account-group', () => {
    it('never resolves a group logo, even with a matching BrandLogos cache entry', async () => {
      // A cache entry that WOULD be picked up if groups had logo resolution.
      await BrandLogos.create({
        normalizedName: 'notion',
        domain: 'notion.so',
        brandName: 'Notion',
        source: 'seed',
      });

      const created = await helpers.createAccountGroup({
        name: 'Notion',
        raw: true,
      });
      expect(created.logoDomain).toBeNull();

      const found = await findGroupInList({ id: created.id });
      expect(found?.logoDomain).toBeNull();
      expect(found?.logoInitials).toBeNull();
      expect(found?.logoColor).toBeNull();
    });

    it('returns 422 when logoDomain and logoInitials are both set', async () => {
      const res = await helpers.createAccountGroup({
        name: 'Both Logos',
        logoDomain: 'netflix.com',
        logoInitials: 'NF',
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/account-group/:groupId – logo fields
//
// The response body is a single-element array whose first item is the updated
// group. Null logo fields are the reset: they leave the group indistinguishable
// from one that never had a logo.
// ---------------------------------------------------------------------------

describe('AccountGroup PUT logo', () => {
  describe('PUT /account-group/:groupId', () => {
    it('sets a logoDomain', async () => {
      const group = await helpers.createAccountGroup({
        name: 'Banking',
        raw: true,
      });

      const [updated] = await helpers.updateAccountGroup({
        groupId: group.id,
        logoDomain: 'bank.example',
        raw: true,
      });

      expect(updated?.logoDomain).toBe('bank.example');
      expect(updated).not.toHaveProperty('logoSource');
    });

    it('preserves the monogram across a payload with nothing to write and a rename', async () => {
      const group = await helpers.createAccountGroup({
        name: 'Keep Mono',
        logoInitials: 'KM',
        logoColor: '#7355be',
        raw: true,
      });

      const noopRes = await helpers.updateAccountGroup({
        groupId: group.id,
        raw: false,
      });
      expect(noopRes.statusCode).toBe(200);

      const [stored] = helpers.extractResponse(noopRes);
      expect(stored).toMatchObject({
        id: group.id,
        name: 'Keep Mono',
        logoDomain: null,
        logoInitials: 'KM',
        logoColor: '#7355be',
      });

      const [renamed] = await helpers.updateAccountGroup({
        groupId: group.id,
        name: 'Keep Mono Renamed',
        raw: true,
      });

      expect(renamed?.name).toBe('Keep Mono Renamed');
      expect(renamed?.logoInitials).toBe('KM');
      expect(renamed?.logoColor).toBe('#7355be');
      expect(renamed?.logoDomain).toBeNull();
    });

    it('clears a monogram back to null when both logo fields are sent as null', async () => {
      const group = await helpers.createAccountGroup({
        name: 'Reset Mono',
        logoInitials: 'RM',
        logoColor: '#7355be',
        raw: true,
      });

      const [updated] = await helpers.updateAccountGroup({
        groupId: group.id,
        logoDomain: null,
        logoInitials: null,
        raw: true,
      });

      expect(updated?.logoDomain).toBeNull();
      expect(updated?.logoInitials).toBeNull();
      expect(updated?.logoColor).toBeNull();
      expect(updated).not.toHaveProperty('logoSource');
    });

    it('returns 422 when the payload carries both logoDomain and logoInitials', async () => {
      const group = await helpers.createAccountGroup({
        name: 'Both On Update',
        raw: true,
      });

      const res = await helpers.updateAccountGroup({
        groupId: group.id,
        logoDomain: 'netflix.com',
        logoInitials: 'NF',
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for a group that does not exist', async () => {
      const res = await helpers.updateAccountGroup({
        groupId: generateRandomRecordId(),
        logoDomain: 'example.com',
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/account-group – serializer must expose the logo fields
// ---------------------------------------------------------------------------

describe('AccountGroup logo read path', () => {
  it('returns the logo fields on GET /account-group', async () => {
    const withDomain = await helpers.createAccountGroup({
      name: 'Listed Domain',
      logoDomain: 'listed.example',
      raw: true,
    });
    expect(withDomain.logoDomain).toBe('listed.example');
    expect(withDomain.logoInitials).toBeNull();
    expect(withDomain.logoColor).toBeNull();
    expect(withDomain).not.toHaveProperty('logoSource');

    const withMonogram = await helpers.createAccountGroup({
      name: 'Listed Mono',
      logoInitials: 'LM',
      logoColor: '#7355be',
      raw: true,
    });
    expect(withMonogram.logoInitials).toBe('LM');
    expect(withMonogram.logoColor).toBe('#7355be');
    expect(withMonogram.logoDomain).toBeNull();
    expect(withMonogram).not.toHaveProperty('logoSource');

    const list = await helpers.getAccountGroups({ raw: true });

    const domainItem = list.find((group) => group.id === withDomain.id);
    expect(domainItem?.logoDomain).toBe('listed.example');
    expect(domainItem?.logoInitials).toBeNull();
    expect(domainItem?.logoColor).toBeNull();
    expect(domainItem).not.toHaveProperty('logoSource');

    const monogramItem = list.find((group) => group.id === withMonogram.id);
    expect(monogramItem?.logoInitials).toBe('LM');
    expect(monogramItem?.logoColor).toBe('#7355be');
    expect(monogramItem?.logoDomain).toBeNull();
    expect(monogramItem).not.toHaveProperty('logoSource');
  });
});

describe('AccountGroup logo icon and image slots', () => {
  it('creates with logoIcon + logoColor', async () => {
    const group = await helpers.createAccountGroup({
      name: 'Icon Group',
      logoIcon: 'food-24-regular',
      logoColor: '#7355be',
      raw: true,
    });

    expect(group).toMatchObject({
      logoIcon: 'food-24-regular',
      logoColor: '#7355be',
      logoInitials: null,
    });
  });

  it('sets logoIcon on update and evicts the monogram', async () => {
    const group = await helpers.createAccountGroup({
      name: 'Mono Group',
      logoInitials: 'MG',
      raw: true,
    });

    const [updated] = await helpers.updateAccountGroup({
      groupId: group.id,
      logoIcon: 'food-24-regular',
      raw: true,
    });

    expect(updated).toMatchObject({
      logoIcon: 'food-24-regular',
      logoInitials: null,
    });
  });

  it('clears every slot with the three-null payload', async () => {
    const group = await helpers.createAccountGroup({
      name: 'Reset Icon',
      logoIcon: 'food-24-regular',
      raw: true,
    });

    const response = await helpers.updateAccountGroup({
      groupId: group.id,
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
      raw: false,
    });

    expect(response.statusCode).toBe(200);
    expect(await findGroupInList({ id: group.id })).toMatchObject({
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
    });
  });

  it('rejects logoImage because the body is strict', async () => {
    const group = await helpers.createAccountGroup({
      name: 'Strict Group',
      raw: true,
    });

    const response = await helpers.updateAccountGroup({
      groupId: group.id,
      ...({ logoImage: PNG_1X1_DATA_URL } as object),
      raw: false,
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});
