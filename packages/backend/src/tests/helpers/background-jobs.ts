import { makeRequest } from './common';

export function getBackgroundJob({ jobId }: { jobId: string }) {
  return makeRequest({ method: 'get', url: `/background-jobs/${jobId}`, followBackgroundJob: false });
}
