import type { ShareInvitationModel } from '@bt/shared/types';
import type { ListMembersResult } from '@services/sharing/members/list-members.service';
import type { SharedWithMeItem } from '@services/sharing/members/list-shared-with-me.service';

type ShareUser = { id: number; username: string; avatar?: string | null } | null;

const presentShareUser = ({ user }: { user: ShareUser }) => (user ? { id: user.id, username: user.username } : null);

/**
 * An invitation as an assistant needs it. The accept-link token, the avatars, the resend bookkeeping and
 * the server's email flag stay out. The invitee email is the address the owner typed, so only a sent
 * invitation carries it: a received one would only echo the caller's own address.
 */
export function presentShareInvitation({
  invitation,
  direction,
}: {
  invitation: Omit<ShareInvitationModel, 'token'> & {
    resourceName: string | null;
    owner: ShareUser;
    invitee: ShareUser;
  };
  direction: 'sent' | 'received';
}) {
  return {
    id: invitation.id,
    direction,
    resourceType: invitation.resourceType,
    resourceId: invitation.resourceId,
    resourceName: invitation.resourceName,
    permission: invitation.permission,
    policy: invitation.policy,
    status: invitation.status,
    ...(direction === 'sent' ? { inviteeEmail: invitation.inviteeEmail } : {}),
    owner: presentShareUser({ user: invitation.owner }),
    invitee: presentShareUser({ user: invitation.invitee }),
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptedAt: invitation.acceptedAt,
    declinedAt: invitation.declinedAt,
    revokedAt: invitation.revokedAt,
  };
}

/** The members of a shared resource: who, in which role and with which permission. No avatars, no share ids. */
export function presentShareMembers({ result }: { result: ListMembersResult }) {
  return {
    resourceType: result.resourceType,
    resourceId: result.resourceId,
    resourceName: result.resourceName,
    members: result.members.map((member) => ({
      user: presentShareUser({ user: member.user }),
      role: member.role,
      permission: member.permission,
      policy: member.policy,
      acceptedAt: member.acceptedAt,
    })),
  };
}

/** One resource somebody shared with the caller, with its owner's name. */
export function presentSharedWithMe({ share }: { share: SharedWithMeItem }) {
  return {
    resourceType: share.resourceType,
    resourceId: share.resourceId,
    resourceName: share.resourceName,
    permission: share.permission,
    policy: share.policy,
    acceptedAt: share.acceptedAt,
    owner: presentShareUser({ user: share.owner }),
    accessSource: share.accessSource,
  };
}
