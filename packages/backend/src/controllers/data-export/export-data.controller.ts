import { API_ERROR_CODES, ALL_EXPORT_GROUPS, EXPORT_FORMATS } from '@bt/shared/types';
import { dateRange, uniqueRecordIds, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { logger } from '@js/utils';
import { exportUserData, ExportTooLargeError } from '@services/data-export';
import { z } from 'zod';

/**
 * POST /user/data-export
 *
 * Bypasses the standard JSON envelope and writes a binary zip directly to the
 * response. The controller-factory wrapper detects `res.headersSent` after the
 * handler runs and skips its normal envelope serialization for this case.
 *
 * `dateRange` uses calendar-day boundaries (YYYY-MM-DD), not instants — full
 * ISO datetimes are rejected to avoid ambiguity over how the time-of-day
 * portion would be honored against the export's day-granular filter.
 */
export const exportDataController = createController(
  z.object({
    body: z.object({
      format: z.enum(EXPORT_FORMATS).default('json'),
      groups: z.array(z.enum(ALL_EXPORT_GROUPS)).default([...ALL_EXPORT_GROUPS]),
      dateRange: withDateOrder(z.object(dateRange())).optional(),
      accountIds: uniqueRecordIds({ min: 1 }).optional(),
    }),
  }),
  async ({ user, body, res, req }) => {
    // Observability for the "client paid for the full transformer run but
    // disconnected before the response landed" case. The response write
    // below silently no-ops on an aborted socket, so log it explicitly.
    req.on('close', () => {
      if (!res.writableEnded) {
        logger.info(
          `Data export response aborted by client (format=${body.format}, userId=${user.id}, groupCount=${body.groups.length})`,
        );
      }
    });
    try {
      const result = await exportUserData({
        userId: user.id,
        format: body.format,
        groups: body.groups,
        dateRange: body.dateRange,
        accountIds: body.accountIds,
      });

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Length', result.buffer.length.toString());
      res.setHeader('X-Total-Rows', result.totalRows.toString());
      res.status(200).end(result.buffer);
      return;
    } catch (err) {
      if (err instanceof ExportTooLargeError) {
        // Surface a clean 409 with a code the frontend can show as a specific
        // copy ("your data exceeds X rows…") rather than a generic 500.
        throw new ConflictError({
          code: API_ERROR_CODES.payloadTooLarge,
          message: t({ key: 'dataExport.tooManyRows', variables: { rowCount: err.rowCount, limit: err.limit } }),
          details: { rowCount: err.rowCount, limit: err.limit },
        });
      }
      logger.error({
        message: `Data export failed for userId=${user.id} (format=${body.format}, groupCount=${body.groups.length})`,
        error: err as Error,
      });
      throw err;
    }
  },
);
