import { createController } from '@controllers/helpers/controller-factory';
import { getBackgroundJob } from '@services/background-jobs/background-jobs.service';
import { z } from 'zod';

export const getBackgroundJobController = createController(
  z.object({ params: z.object({ jobId: z.uuid() }) }),
  async ({ user, params, res }) => {
    const job = await getBackgroundJob({ userId: user.id, jobId: params.jobId });

    if (job.state === 'pending') return { data: { backgroundJobId: params.jobId }, statusCode: 202 };

    res.status(job.statusCode).json(job.body);
  },
);
