import type { OfxParseResult, ResourceLease } from '@bt/shared/types';
import { OFX_UPLOAD_IDLE_TTL_MS, OFX_UPLOAD_MAX_LIFETIME_MS } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import { createExpiringUploadCache } from '@services/common/expiring-upload-cache';

export const ofxUploadCache = createExpiringUploadCache<OfxParseResult>({
  namespace: 'budget-tracker-ofx-uploads',
  idleTtlMs: OFX_UPLOAD_IDLE_TTL_MS,
  maxLifetimeMs: OFX_UPLOAD_MAX_LIFETIME_MS,
  missingMessage: 'This OFX upload is no longer available. Please upload the file again.',
  claimedMessage: 'An import for this file is already in progress.',
});

// The cache builds its errors from strings fixed at module load, outside any request locale.
async function withTranslatedCacheErrors<T>({ operation }: { operation: () => Promise<T> }): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError({ message: t({ key: 'ofxImport.uploadUnavailable' }) });
    if (error instanceof ConflictError) throw new ConflictError({ message: t({ key: 'ofxImport.importInProgress' }) });
    throw error;
  }
}

export async function storeOfxUpload({
  userId,
  result,
}: {
  userId: number;
  result: OfxParseResult;
}): Promise<{ uploadId: string; lease: ResourceLease }> {
  const { id, lease } = await ofxUploadCache.store({ userId, payload: result });
  return { uploadId: id, lease };
}

export function claimOfxUpload({
  userId,
  uploadId,
  jobId,
  isClaimStale,
}: {
  userId: number;
  uploadId: string;
  jobId: string;
  isClaimStale: ({ jobId }: { jobId: string }) => Promise<boolean>;
}): Promise<ResourceLease> {
  return withTranslatedCacheErrors({
    operation: () => ofxUploadCache.claim({ userId, id: uploadId, jobId, isClaimStale }),
  });
}

export function readOfxUpload({ userId, uploadId }: { userId: number; uploadId: string }): Promise<OfxParseResult> {
  return withTranslatedCacheErrors({ operation: () => ofxUploadCache.read({ userId, id: uploadId }) });
}

export function deleteOfxUpload({ userId, uploadId }: { userId: number; uploadId: string }): Promise<void> {
  return ofxUploadCache.remove({ userId, id: uploadId });
}
