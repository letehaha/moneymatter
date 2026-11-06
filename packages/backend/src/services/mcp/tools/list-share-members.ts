import { shareableResourceTypeEnum } from '@controllers/share/_zod';
import { listMembers } from '@services/sharing/members/list-members.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentShareMembers } from './share-output';

export const listShareMembersTool = defineTool({
  name: 'list_share_members',
  toolset: 'imports',
  access: 'read',
  description:
    'List who has access to an account, household or tracker the signed-in user manages: the owner and every member who accepted. Returns { resourceType, resourceId, resourceName, members }, each member with user ({ id, username }), role (owner or recipient), permission, policy and acceptedAt (null for the owner). Pending invitations are not members: see list_share_invitations. A resource the user does not manage reads as not found. Read-only: changing or removing members is done in the app.',
  input: {
    resourceType: shareableResourceTypeEnum.describe('What is shared: account, household or tracker'),
    resourceId: z.string().min(1).max(255).describe('The id of the shared account, household or tracker'),
  },
  run: async ({ userId, args }) => {
    const result = await listMembers({
      userId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    });
    return presentShareMembers({ result });
  },
});
