import { FEATURES } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodSettingsPatchSchema } from '@models/user-settings.model';
import { patchUserSettings } from '@services/user-settings/patch-settings';
import omit from 'lodash/omit';

import { getUserId, jsonContent, requireFeature, requireScope } from './helpers';

// The REST patch schema without `ai`: the AI configuration stays in the app. The shape is taken
// from the schema, so a settings key added there is accepted here without a change to this file.
const patchSchema = ZodSettingsPatchSchema.omit({ ai: true });
const inputSchema = patchSchema.shape;

export function registerUpdateUserSettings(server: McpServer) {
  server.registerTool(
    'update_user_settings',
    {
      description:
        "Change the user's app settings. Send only the keys to change: the patch is merged into the stored settings, objects key by key, so omitted keys stay. An array replaces the stored one whole, so send the full list. Read the current values with get_user_settings first. Covers language, notification preferences, dashboard, sidebar, table layout, saved views, import and bank sync options and category lists. A fire key (the FIRE planner inputs) needs a plan that includes the FIRE planner. The AI configuration cannot be changed here. Works for accounts whose plan no longer includes editing, as the app does. Returns the settings after the change. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      // `PUT` and `PATCH /user/settings` are in READ_ONLY_ROUTES and carry no base-currency lock, so
      // the tool allows a read-only user and skips the lock.
      requireScope({ extra, scope: 'finance:write', allowReadOnly: true });
      trackMcpToolUsed({ userId, tool: 'update_user_settings', clientId: extra.authInfo?.clientId });

      const input = args as Record<string, unknown>;
      if ('ai' in input) {
        throw new Error('AI settings cannot be changed through this tool. Change them in the app.');
      }
      // The REST route gate: a `fire` key needs the FIRE planner.
      if (input.fire !== undefined) {
        await requireFeature({ userId, feature: FEATURES.fire_planner });
      }

      const patch = patchSchema.parse(input);
      const settings = await patchUserSettings({ userId, patch });

      return jsonContent({ data: omit(settings, 'ai') });
    },
  );
}
