import {
  RESOURCE_TYPES,
  ResourceType,
  SHARE_PERMISSIONS,
  ShareInvitationEmailOutcome,
  SharePermission,
  SharePolicy,
} from '@bt/shared/types';
import { authPool } from '@config/auth';
import Users from '@models/users.model';
import type { acceptInvitation as apiAcceptInvitation } from '@services/sharing/invitations/accept-invitation.service';
import type { createInvitation as apiCreateInvitation } from '@services/sharing/invitations/create-invitation.service';
import type { declineInvitation as apiDeclineInvitation } from '@services/sharing/invitations/decline-invitation.service';
import type {
  listReceivedInvitations as apiListReceivedInvitations,
  listSentInvitations as apiListSentInvitations,
} from '@services/sharing/invitations/list-invitations.service';
import type { ListMembersResult } from '@services/sharing/members/list-members.service';
import type { SharedWithMeItem } from '@services/sharing/members/list-shared-with-me.service';

import { extractCookies, makeAuthRequest, makeRequest } from './common';

export interface SecondUserHandle {
  cookies: string;
  email: string;
}

/**
 * Sign up a fresh user via the better-auth mock. Returns their session cookies plus the
 * email used for sign-up so tests can later look the user up by email. The caller is
 * responsible for swapping `global.APP_AUTH_COOKIES` (use `asUser` below).
 */
export async function signUpSecondUser({
  email,
  name = 'Second User',
}: {
  email?: string;
  name?: string;
} = {}): Promise<SecondUserHandle> {
  const userEmail = email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const signupRes = await makeAuthRequest({
    method: 'post',
    url: '/auth/sign-up/email',
    payload: {
      email: userEmail,
      password: 'testpassword123',
      name,
    },
  });
  // Match the suite's default user: legacy entitlements, not a fresh trial. A trial
  // would strip backup/export features from every second-user test that isn't about plans.
  await Users.update({ trialEndsAt: null }, { where: { authUserId: signupRes.body.user.id } });

  return { cookies: extractCookies(signupRes), email: userEmail };
}

/**
 * Run `fn` while the request cookies belong to the given user. Restores the original
 * cookies (the primary test user) afterwards even if `fn` throws.
 */
export async function asUser<T>({ cookies, fn }: { cookies: string; fn: () => Promise<T> }): Promise<T> {
  const original = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = cookies;
  try {
    return await fn();
  } finally {
    global.APP_AUTH_COOKIES = original;
  }
}

/** Run `fn` with an empty cookie string, so the request carries no session at all
 *  and the endpoint under test must answer 401. */
export function withoutSession<T>(fn: () => Promise<T>): Promise<T> {
  return asUser({ cookies: '', fn });
}

/**
 * Set the active user's base currency. Call inside `asUser` when configuring a second
 * user during test setup.
 */
export async function setBaseCurrencyForActiveUser({ currencyCode }: { currencyCode: string }) {
  return makeRequest({
    method: 'post',
    url: '/user/currencies/base',
    payload: { currencyCode },
  });
}

export interface CreateInvitationPayload {
  inviteeEmail: string;
  resourceType: ResourceType;
  resourceId: number | string;
  permission: SharePermission;
  policy?: SharePolicy | null;
}

/**
 * Response shape for create / resend endpoints: the invitation fields flattened with the
 * email-send outcome. Mirrors what the controllers actually return — the service result is
 * `{ invitation, emailOutcome }` and the controllers spread `invitation` so callers can
 * read both shapes from a single object.
 */
type InvitationSendResponse = Awaited<ReturnType<typeof apiCreateInvitation>>['invitation'] & {
  emailOutcome: ShareInvitationEmailOutcome;
};

export async function createShareInvitation<R extends boolean | undefined = undefined>({
  raw,
  ...payload
}: CreateInvitationPayload & { raw?: R }) {
  return makeRequest<InvitationSendResponse, R>({
    method: 'post',
    url: '/share/invitations',
    payload,
    raw,
  });
}

/**
 * Convenience wrapper for the most common test fixture: a household invitation owned by
 * `ownerUserId` to `inviteeEmail`. Defaults to `write` permission (matches what tests have
 * historically assumed). Always returns the raw invitation row — wrap with `raw: false` at
 * call sites that need the response envelope instead.
 */
export async function createHouseholdInvitation({
  ownerUserId,
  inviteeEmail,
  permission = SHARE_PERMISSIONS.write,
}: {
  ownerUserId: number;
  inviteeEmail: string;
  permission?: SharePermission;
}) {
  return createShareInvitation({
    inviteeEmail,
    resourceType: RESOURCE_TYPES.household,
    resourceId: ownerUserId,
    permission,
    raw: true,
  });
}

export async function listSentShareInvitations<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiListSentInvitations>>, R>({
    method: 'get',
    url: '/share/invitations/sent',
    raw,
  });
}

export async function listReceivedShareInvitations<R extends boolean | undefined = undefined>({
  raw,
}: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiListReceivedInvitations>>, R>({
    method: 'get',
    url: '/share/invitations/received',
    raw,
  });
}

export async function acceptShareInvitation<R extends boolean | undefined = undefined>({
  token,
  raw,
}: {
  token: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiAcceptInvitation>>, R>({
    method: 'post',
    url: `/share/invitations/${encodeURIComponent(token)}/accept`,
    raw,
  });
}

export async function declineShareInvitation<R extends boolean | undefined = undefined>({
  token,
  raw,
}: {
  token: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiDeclineInvitation>>, R>({
    method: 'post',
    url: `/share/invitations/${encodeURIComponent(token)}/decline`,
    raw,
  });
}

export async function resendShareInvitation<R extends boolean | undefined = undefined>({
  invitationId,
  raw,
}: {
  invitationId: string;
  raw?: R;
}) {
  return makeRequest<InvitationSendResponse, R>({
    method: 'post',
    url: `/share/invitations/${encodeURIComponent(invitationId)}/resend`,
    raw,
  });
}

export async function cancelShareInvitation<R extends boolean | undefined = undefined>({
  invitationId,
  raw,
}: {
  invitationId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof apiCreateInvitation>>['invitation'], R>({
    method: 'delete',
    url: `/share/invitations/${encodeURIComponent(invitationId)}`,
    raw,
  });
}

export async function backInviteFromShareInvitation<R extends boolean | undefined = undefined>({
  sourceInvitationId,
  permission,
  policy,
  raw,
}: {
  sourceInvitationId: string;
  permission: SharePermission;
  policy?: SharePolicy | null;
  raw?: R;
}) {
  return makeRequest<InvitationSendResponse, R>({
    method: 'post',
    url: `/share/invitations/${encodeURIComponent(sourceInvitationId)}/back-invite`,
    payload: { permission, policy },
    raw,
  });
}

/**
 * Resolve the app-level `Users` row for a given email address. Looks up the
 * better-auth `ba_user` table first to get the `authUserId`, then finds the
 * matching `Users` row. Throws if either lookup fails.
 */
export async function findAppUserByEmail({ email }: { email: string }) {
  const baUserRes = await authPool.query<{ id: string }>('SELECT id FROM ba_user WHERE email = $1', [email]);
  const baUserId = baUserRes.rows[0]?.id;
  if (!baUserId) throw new Error(`No ba_user for ${email}`);
  const appUser = await Users.findOne({ where: { authUserId: baUserId } });
  if (!appUser) throw new Error(`No app user for ${email}`);
  return appUser;
}

export async function listShareMembers<R extends boolean | undefined = undefined>({
  resourceType,
  resourceId,
  raw,
}: {
  resourceType: ResourceType;
  resourceId: number | string;
  raw?: R;
}) {
  return makeRequest<ListMembersResult, R>({
    method: 'get',
    url: `/share/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(String(resourceId))}/members`,
    raw,
  });
}

export async function updateShareMember<R extends boolean | undefined = undefined>({
  resourceType,
  resourceId,
  memberUserId,
  permission,
  policy,
  raw,
}: {
  resourceType: ResourceType;
  resourceId: number | string;
  memberUserId: number;
  permission?: SharePermission;
  policy?: SharePolicy | null;
  raw?: R;
}) {
  return makeRequest<{ id: string; permission: SharePermission; policy: SharePolicy | null }, R>({
    method: 'patch',
    url: `/share/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(String(resourceId))}/members/${memberUserId}`,
    payload: { permission, policy },
    raw,
  });
}

export async function revokeShareMember<R extends boolean | undefined = undefined>({
  resourceType,
  resourceId,
  memberUserId,
  raw,
}: {
  resourceType: ResourceType;
  resourceId: number | string;
  memberUserId: number;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'delete',
    url: `/share/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(String(resourceId))}/members/${memberUserId}`,
    raw,
  });
}

export async function listSharedWithMe<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<SharedWithMeItem[], R>({
    method: 'get',
    url: '/share/shared-with-me',
    raw,
  });
}

export async function leaveShare<R extends boolean | undefined = undefined>({
  resourceType,
  resourceId,
  raw,
}: {
  resourceType: ResourceType;
  resourceId: number | string;
  raw?: R;
}) {
  return makeRequest<undefined, R>({
    method: 'post',
    url: `/share/shared-with-me/${encodeURIComponent(resourceType)}/${encodeURIComponent(String(resourceId))}/leave`,
    raw,
  });
}

/**
 * Sign up a fresh second user and immediately set their base currency via the
 * API. Defaults to the test suite's `global.BASE_CURRENCY.code` when no
 * `currencyCode` is supplied, and generates a unique email when none is given.
 *
 * Returns the same `SecondUserHandle` as `signUpSecondUser` so callers can
 * pass `cookies` straight to `asUser`.
 */
export async function provisionSecondUserWithBaseCurrency({
  email,
  currencyCode,
}: { email?: string; currencyCode?: string } = {}): Promise<SecondUserHandle> {
  const handle = await signUpSecondUser({ email });
  await asUser({
    cookies: handle.cookies,
    fn: async () => {
      const res = await setBaseCurrencyForActiveUser({
        currencyCode: currencyCode ?? global.BASE_CURRENCY.code,
      });
      if (res.statusCode !== 200) {
        throw new Error(`Failed to set base currency for second user: ${res.statusCode} ${JSON.stringify(res.body)}`);
      }
    },
  });
  return handle;
}

export async function asBaseCurrencyUser({ currencyCode, fn }: { currencyCode: string; fn: () => Promise<void> }) {
  const user = await provisionSecondUserWithBaseCurrency({ currencyCode });
  await asUser({ cookies: user.cookies, fn });
}
