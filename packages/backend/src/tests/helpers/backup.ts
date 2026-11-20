import {
  type BackupManifest,
  type BackupManifestFileEntry,
  type BackupRestoreActiveStatus,
  type BackupRestoreStatusResponse,
  parseFilenameFromContentDisposition,
} from '@bt/shared/types';
import { expect } from '@jest/globals';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import { sha256Hex } from '@services/backup/sha256';
import { RateLimitService } from '@services/common/rate-limit.service';
import AdmZip from 'adm-zip';
import Big from 'big.js';
import JSZip from 'jszip';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

type BackupRow = Record<string, unknown>;

/** Export and restore have their own per-user rate buckets, enforced in the test env. */
export async function resetBackupRateLimits(): Promise<void> {
  const user = (await makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
  await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
  await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
}

/** Read an unpacked archive directory into the path-to-buffer map `repackBackup` takes. */
export function readBackupFixture({ dir }: { dir: string }): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(dir, full), readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

/** Restore `fileContent` and wait for the job, asserting it is accepted and completes. */
export async function restoreBackupAndWait({ fileContent }: { fileContent: string }) {
  const restore = await restoreBackup({ fileContent });
  expect({ statusCode: restore.statusCode, message: restore.message }).toEqual({ statusCode: 200, message: null });
  const status = await waitForRestore({ jobId: restore.jobId! });
  expect({ status: status.status, error: status.error }).toEqual({ status: 'completed', error: undefined });
  return status;
}

export async function exportParsedBackup(): Promise<ParsedBackupArchive> {
  const response = await exportBackup();
  expect(response.statusCode).toBe(200);
  return parseBackupArchive({ buffer: response.body });
}

export function backupRows({ archive, name }: { archive: ParsedBackupArchive; name: string }): BackupRow[] {
  return archive.readData({ name }) as BackupRow[];
}

export function findBackupRow({ rows, key, value }: { rows: BackupRow[]; key: string; value: unknown }): BackupRow {
  const row = rows.find((candidate) => candidate[key] === value);
  expect(row).toBeDefined();
  return row!;
}

/** Exact equality of a dumped DECIMAL (a string like "1500.750000000000000000") with an expected decimal. */
export function expectDecimal({ actual, expected }: { actual: unknown; expected: string }): void {
  expect(typeof actual).toBe('string');
  expect(new Big(actual as string).eq(expected)).toBe(true);
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    const out: BackupRow = {};
    for (const key of Object.keys(value as BackupRow).toSorted()) out[key] = deepSort((value as BackupRow)[key]);
    return out;
  }
  return value;
}

/** Order-independent, key-sorted canonical form of a dumped row array, for deep equality. */
export function canonicalBackupRows({ rows }: { rows: unknown }): string[] {
  return (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(deepSort(row))).toSorted();
}

export const BLOCKING_RESTORE_WARNING_CODES = new Set([
  'foreign_reference_dropped',
  'foreign_reference_nulled',
  'invalid_row_dropped',
  'currency_missing',
  'unknown_column_dropped',
]);
