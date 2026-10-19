import {
  type BackupManifest,
  type BackupManifestFileEntry,
  type BackupRestoreActiveStatus,
  type BackupRestoreStatusResponse,
  parseFilenameFromContentDisposition,
} from '@bt/shared/types';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import { sha256Hex } from '@services/backup/sha256';
import AdmZip from 'adm-zip';
import JSZip from 'jszip';
import request from 'supertest';

import { makeRequest } from './common';

interface ExportBackupResponse {
  statusCode: number;
  body: Buffer;
  filename: string | null;
  contentType: string | null;
  errorBody: Record<string, unknown> | null;
}

/**
 * Drives the backup endpoint in tests. Like the data-export helper, it bypasses
 * `makeRequest` because the response is a binary zip rather than the JSON
 * envelope, and returns the raw buffer plus the headers the frontend reads.
 */
export async function exportBackup({ withoutAuth }: { withoutAuth?: boolean } = {}): Promise<ExportBackupResponse> {
  const base = request(app).post(`${API_PREFIX}/user/backup`).set('Accept', 'application/zip');
  if (!withoutAuth && global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);

  const result = await base
    .send({})
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  const contentType = (result.headers['content-type'] as string | undefined) ?? null;
  let errorBody: Record<string, unknown> | null = null;
  if (contentType?.includes('application/json')) {
    try {
      errorBody = JSON.parse((result.body as Buffer).toString('utf8')) as Record<string, unknown>;
    } catch {
      errorBody = null;
    }
  }

  return {
    statusCode: result.status,
    body: result.body as Buffer,
    filename: parseFilenameFromContentDisposition({
      header: (result.headers['content-disposition'] as string | undefined) ?? null,
    }),
    contentType,
    errorBody,
  };
}

export interface ParsedBackupArchive {
  files: Map<string, Buffer>;
  manifest: BackupManifest;
  /** Parse a `data/<name>.json` file, or null if it's absent. */
  readData: ({ name }: { name: string }) => unknown;
}

/** Unzip a backup `body` and expose the file index, manifest, and data reader. */
export function parseBackupArchive({ buffer }: { buffer: Buffer }): ParsedBackupArchive {
  const zip = new AdmZip(buffer);
  const files = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory) files.set(entry.entryName, entry.getData());
  }

  const manifestBuf = files.get('manifest.json');
  if (!manifestBuf) {
    throw new Error('Backup archive is missing manifest.json – should be impossible.');
  }
  const manifest = JSON.parse(manifestBuf.toString('utf8')) as BackupManifest;

  const readData = ({ name }: { name: string }): unknown => {
    const buf = files.get(`data/${name}.json`);
    return buf ? (JSON.parse(buf.toString('utf8')) as unknown) : null;
  };

  return { files, manifest, readData };
}

/**
 * Re-zip an edited file set back into a base64 backup upload. With
 * `syncChecksums` (default) it recomputes every data/reference file's SHA-256
 * into the manifest, so a structurally-valid edit still passes preflight and
 * fails only where the test intends. Pass `syncChecksums: false` to leave the
 * manifest stale on purpose (checksum-mismatch case). Manifest fields other
 * than `files` (e.g. `formatVersion`) are preserved, so a test can tamper them
 * first and still refresh the checksums.
 */
export async function repackBackup({
  files,
  syncChecksums = true,
}: {
  files: Map<string, Buffer>;
  syncChecksums?: boolean;
}): Promise<string> {
  const manifestBuf = files.get('manifest.json');
  if (!manifestBuf) throw new Error('repackBackup: files map is missing manifest.json.');
  const manifest = JSON.parse(manifestBuf.toString('utf8')) as BackupManifest;

  if (syncChecksums) {
    const nextFiles: Record<string, BackupManifestFileEntry> = {};
    for (const [path, buf] of files) {
      if (path === 'manifest.json') continue;
      let rows = 1;
      try {
        const parsed = JSON.parse(buf.toString('utf8'));
        rows = Array.isArray(parsed) ? parsed.length : 1;
      } catch {
        rows = 0;
      }
      nextFiles[path] = { rows, sha256: sha256Hex({ buffer: buf }) };
    }
    manifest.files = nextFiles;
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  }

  const zip = new JSZip();
  for (const [path, buf] of files) zip.file(path, buf);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return buffer.toString('base64');
}

export interface RestoreBackupResult {
  statusCode: number;
  jobId: string | null;
  code: string | null;
  message: string | null;
  details: Record<string, unknown> | null;
}

/**
 * POST /user/backup/restore. Runs preflight synchronously then enqueues the
 * async worker: a 200 carries `{ jobId }` to poll with {@link waitForRestore};
 * a 422/409 carries the error `code`/`message`/`details`. Uses the ambient auth
 * cookies, so it composes with `asUser` for cross-user restores.
 */
export async function restoreBackup({
  fileContent,
  acknowledgeSharing,
  headers,
}: {
  fileContent: string;
  acknowledgeSharing?: boolean;
  headers?: Record<string, string>;
}): Promise<RestoreBackupResult> {
  const payload: Record<string, unknown> = { fileContent };
  if (acknowledgeSharing !== undefined) payload.acknowledgeSharing = acknowledgeSharing;

  const res = await makeRequest<{ jobId?: string; code?: string; message?: string; details?: Record<string, unknown> }>(
    {
      method: 'post',
      url: '/user/backup/restore',
      payload,
      headers,
    },
  );

  const response = res.body?.response ?? {};
  return {
    statusCode: res.statusCode,
    jobId: response.jobId ?? null,
    code: response.code ?? null,
    message: response.message ?? null,
    details: response.details ?? null,
  };
}

export function getRestoreStatus<R extends boolean | undefined = undefined>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}) {
  return makeRequest<BackupRestoreStatusResponse, R>({
    method: 'get',
    url: `/user/backup/restore/status/${jobId}`,
    raw,
  });
}

/** GET /user/backup/restore/status — user-scoped active restore (no job id). */
export function getActiveRestoreStatus<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<BackupRestoreActiveStatus, R>({
    method: 'get',
    url: '/user/backup/restore/status',
    raw,
  });
}

/**
 * Poll GET /user/backup/restore/status/:jobId every 100 ms until the worker
 * reports `completed` or `failed`. The restore runs in a BullMQ worker inside
 * the test process, so the POST only returns a jobId — callers must poll for
 * the terminal state. Mirrors `waitForCsvImportCompletion`.
 */
export async function waitForRestore({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<BackupRestoreStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getRestoreStatus({ jobId, raw: true });
    if (status.status === 'completed' || status.status === 'failed') return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Backup restore job ${jobId} did not finish within ${timeoutMs}ms`);
}
