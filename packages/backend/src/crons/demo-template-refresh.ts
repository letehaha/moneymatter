import { logger } from '@js/utils/logger';
import { refreshDemoTemplate } from '@services/demo/demo-template-cache.service';
import { CronJob } from 'cron';

/**
 * Demo template refresh cron job.
 * Runs daily at midnight UTC to regenerate the cached demo data template
 * with fresh dates. Also eagerly generates the initial template on startup.
 */
class DemoTemplateRefreshCronService {
  private cronJob: CronJob | null = null;

  public startCron(): void {
    if (this.cronJob) {
      logger.info('Demo template refresh cron job is already running');
      return;
    }

    refreshDemoTemplate();

    this.cronJob = new CronJob('0 0 * * *', refreshDemoTemplate, null, false, 'UTC');

    this.cronJob.start();
    logger.info('Demo template refresh cron job started (runs daily at midnight UTC)');
  }

  public stopCron(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Demo template refresh cron job stopped');
    }
  }
}

export const demoTemplateRefreshCron = new DemoTemplateRefreshCronService();
