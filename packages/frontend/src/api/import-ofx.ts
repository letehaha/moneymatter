import { api } from '@/api/_api';
import type {
  DetectOfxDuplicatesRequest,
  DetectOfxDuplicatesResponse,
  ExecuteOfxRequest,
  ExecuteOfxResponse,
  OfxImportProgress,
  OfxUploadResponse,
} from '@bt/shared/types';

/** Uploads the OFX/QFX bytes once. Later requests use the returned upload id. */
export const uploadOfxFile = async ({
  file,
  signal,
}: {
  file: File;
  signal?: AbortSignal;
}): Promise<OfxUploadResponse> =>
  api.postRaw({
    endpoint: '/import/ofx/upload',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
    options: { signal },
  });

export const detectOfxDuplicates = async (payload: DetectOfxDuplicatesRequest): Promise<DetectOfxDuplicatesResponse> =>
  api.post('/import/ofx/detect-duplicates', payload);

export const executeOfxImport = async (payload: ExecuteOfxRequest): Promise<ExecuteOfxResponse> =>
  api.post('/import/ofx/execute', payload);

export const getOfxImportStatus = async ({ jobId }: { jobId: string }): Promise<OfxImportProgress> =>
  api.get(`/import/ofx/status/${jobId}`);
