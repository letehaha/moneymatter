import { LockedError } from '@js/errors';
import { logger } from '@js/utils';
import { CronJob } from 'cron';

type RunSource = 'Scheduled' | 'Manual';

interface ScheduledSyncDefinition<TResult extends object, TParams> {
  /** Noun phrase spliced into log sentences, e.g. `tag reminders check`. */
  name: string;
  /** Cron expression for the scheduled run. */
  cronExpression: string;
  /** Timezone the cron schedule is interpreted in. */
  timeZone: string;
  /** Human-readable schedule description, appended to the "started" log line. */
  scheduleDescription: string;
  /**
   * Stable code attached to failure logs, e.g. `SHARE_INVITATIONS_EXPIRE_CRON`; written
   * as `<code>_FAILED` (scheduled) and `<code>_MANUAL_FAILED` (manual).
   */
  errorCode?: string;
  /** Function that performs the actual work. */
  run: (params?: TParams) => Promise<TResult>;
}

interface ScheduledSync<TResult extends object, TParams> {
  startCron: () => void;
  stopCron: () => void;
  triggerManualSync: (params?: TParams) => Promise<TResult>;
}

/** Arrays (per-item results, raw errors) are logged as counts so the line stays bounded. */
const summarize = (result: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(result).map(([key, value]) => (Array.isArray(value) ? [`${key}Count`, value.length] : [key, value])),
  );

/**
 * Factory for the cron + manual-trigger wrapper around a job function.
 *
 * Scheduled failures are logged but not re-thrown — `cron` would swallow the
 * promise rejection anyway, and re-throwing would just produce an unhandled
 * rejection. Manual triggers re-throw so the controller can surface the
 * failure to the operator.
 */
export const createScheduledSync = <TResult extends object, TParams = void>(
  definition: ScheduledSyncDefinition<TResult, TParams>,
): ScheduledSync<TResult, TParams> => {
  const { name, cronExpression, timeZone, scheduleDescription, errorCode, run } = definition;
  let job: CronJob | null = null;

  const execute = async ({ source, params }: { source: RunSource; params?: TParams }): Promise<TResult> => {
    logger.info(`Starting ${source.toLowerCase()} ${name}...`);
    const startedAt = Date.now();
    try {
      const result = await run(params);
      logger.info(`${source} ${name} completed`, { ...summarize(result), durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      // `LockedError` means another instance of the same job is still running — not a
      // failure, and surfacing it at `error` level would page operators on every overlap.
      if (error instanceof LockedError) {
        logger.info(`${source} ${name} skipped — previous run still in progress`);
      } else {
        const code = errorCode ? `${errorCode}${source === 'Manual' ? '_MANUAL' : ''}_FAILED` : undefined;
        logger.error({ message: `${source} ${name} failed`, error: error as Error }, code ? { code } : undefined);
      }
      throw error;
    }
  };

  return {
    startCron(): void {
      if (job) {
        logger.info(`${name} cron job is already running`);
        return;
      }
      job = CronJob.from({
        cronTime: cronExpression,
        timeZone,
        start: true,
        onTick: async () => {
          await execute({ source: 'Scheduled' }).catch(() => undefined);
        },
      });
      logger.info(`${name} cron job started — ${scheduleDescription}`);
    },

    stopCron(): void {
      if (job) {
        job.stop();
        job = null;
        logger.info(`${name} cron job stopped`);
      }
    },

    triggerManualSync: (params?: TParams) => execute({ source: 'Manual', params }),
  };
};
