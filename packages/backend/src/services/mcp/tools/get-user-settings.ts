import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import omit from 'lodash/omit';

import { getUserId, jsonContent } from './helpers';

export function registerGetUserSettings(server: McpServer) {
  server.registerTool(
    'get_user_settings',
    {
      description:
        "Read the user's app settings: language, notification preferences, dashboard, sidebar and table layout, saved views, import and bank sync options, and the FIRE planner inputs. Defaults fill in what the user never set. The AI configuration (providers, models, custom instructions) is not part of the result. Change settings with update_user_settings.",
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_user_settings', clientId: extra.authInfo?.clientId });

      const settings = await getUserSettings({ userId });
      return jsonContent({ data: omit(settings, 'ai') });
    },
  );
}
