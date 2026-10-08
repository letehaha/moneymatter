import { BACKUP_FORMAT_VERSION, BACKUP_REFERENCE_FILE_NAMES, type BackupManifest } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import JSZip from 'jszip';
import isPlainObject from 'lodash/isPlainObject';

import { BACKUP_TABLES, type BackupFileName } from '../registry';
import { sha256Hex } from '../sha256';

const BACKUP_FILE_NAMES = BACKUP_TABLES.map((t) => t.fileName);

type Row = Record<string, unknown>;

/**
 * Hard ceiling on the archive's total uncompressed size. Preflight reads every
 * manifest-listed file fully into memory on the API thread, so an unbounded
 * DEFLATE archive (a ~48MB body can inflate to tens of GB) would OOM the shared
 * instance. 1 GiB is generous for a heavy real backup (JSON of every user-owned
 * table) while still bounding a zip bomb well short of memory exhaustion.
 *
 * Default for `loadBackupArchive`'s `maxUncompressedBytes`, which a unit test
 * lowers to drive the guards without materializing a gigabyte-scale archive.
 */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

const OVER_BUDGET_MESSAGE = 'Backup archive is too large to restore: its uncompressed contents exceed the size limit.';

const CORRUPT_ENTRY_MESSAGE = 'Backup archive is corrupt or has been tampered with.';

/**
 * Reject up front when the archive's declared uncompressed size blows the budget,
 * before a single file is decompressed. Reads JSZip's per-entry `uncompressedSize`
 * from the central directory; a malicious archive can understate it, which the
 * running byte tally during decompression (see {@link createBudgetedEntryReader})
 * then catches. `maxUncompressedBytes` is threaded down from `loadBackupArchive`.
 */
function assertUncompressedBudget({ zip, maxUncompressedBytes }: { zip: JSZip; maxUncompressedBytes: number }): void {
  let declaredTotal = 0;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    // oxlint-disable-next-line no-underscore-dangle
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === 'number') declaredTotal += size;
  }
  if (declaredTotal > maxUncompressedBytes) {
    throw new ValidationError({ message: OVER_BUDGET_MESSAGE });
  }
}

/**
 * Reader that decompresses zip entries and keeps a running tally of the bytes it
 * has actually produced, so an archive that understated its central-directory
 * sizes (fooling {@link assertUncompressedBudget}) still can't inflate past the
 * budget in memory. `maxUncompressedBytes` is threaded down from `loadBackupArchive`.
 */
function createBudgetedEntryReader({
  maxUncompressedBytes,
}: {
  maxUncompressedBytes: number;
}): ({ file }: { file: JSZip.JSZipObject }) => Promise<Buffer> {
  let decompressedBytes = 0;
  return async ({ file }) => {
    let bytes: Buffer;
    try {
      bytes = await file.async('nodebuffer');
    } catch {
      // JSZip runs its own integrity probe here (declared vs actual uncompressed
      // size, CRC). A forged entry — e.g. a zip bomb that understated its
      // central-directory size to slip past assertUncompressedBudget — trips it and
      // throws a raw error. Surface it as a 422 instead of letting it escape as a 500.
      throw new ValidationError({ message: CORRUPT_ENTRY_MESSAGE });
    }
    decompressedBytes += bytes.length;
    if (decompressedBytes > maxUncompressedBytes) {
      throw new ValidationError({ message: OVER_BUDGET_MESSAGE });
    }
    return bytes;
  };
}

/**
 * Parsed + integrity-checked backup archive. `data` holds the per-table row
 * arrays for every present data file; `user` is the single tier-1 object;
 * `reference` carries the resolve-or-create catalog subset.
 */
export interface ParsedArchive {
  manifest: BackupManifest;
  data: Map<BackupFileName, Row[]>;
  user: Row | null;
  reference: {
    securities: Row[];
  };
  /** Data files present in the zip whose base name isn't a known backup table. */
  unknownFileNames: string[];
}

function parseJson({ buffer, path }: { buffer: Buffer; path: string }): unknown {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ValidationError({ message: `Backup file ${path} is not valid JSON.` });
  }
}

/**
 * Coerce a checksum-clean data/reference file into a typed row array. The SHA-256
 * gate only proves the bytes match the manifest, not their shape: a file that
 * parses to a non-array would coerce to `[]` (silent data loss for the table),
 * and an array carrying a non-plain-object element (e.g. `[null]`) would later
 * make `collectFileColumns`'s `Object.keys(row)` throw a 500. Reject both as 422.
 */
function assertRowArray({ value, path }: { value: unknown; path: string }): Row[] {
  if (!Array.isArray(value)) {
    throw new ValidationError({
      message: `Backup file ${path} is corrupt: expected a JSON array of rows.`,
    });
  }
  for (const row of value) {
    if (!isPlainObject(row)) {
      throw new ValidationError({
        message: `Backup file ${path} is corrupt: every row must be a JSON object.`,
      });
    }
  }
  return value as Row[];
}

/**
 * Decode the base64 zip, verify the manifest's format version and every file's
 * SHA-256, then parse each data/reference file. Throws a 422 `ValidationError`
 * with a human-readable reason on any structural failure (unreadable zip,
 * oversized contents, missing manifest, unsupported version, checksum mismatch,
 * malformed JSON) — the whole restore is rejected before it can touch the user's
 * data.
 */
export async function loadBackupArchive({
  fileContent,
  maxUncompressedBytes = MAX_TOTAL_UNCOMPRESSED_BYTES,
}: {
  fileContent: string;
  maxUncompressedBytes?: number;
}): Promise<ParsedArchive> {
  // `Buffer.from(str, 'base64')` never throws — it silently drops non-base64 chars
  // — so garbage input decodes to a (possibly empty) buffer and is caught by the
  // zip-load failure below rather than by a base64 guard here.
  const buffer = Buffer.from(fileContent, 'base64');

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ValidationError({ message: 'Backup upload is not a readable zip archive.' });
  }

  assertUncompressedBudget({ zip, maxUncompressedBytes });

  // Running tally guards against an archive that understated its central-directory
  // sizes, so it still can't inflate past the budget in memory.
  const readEntry = createBudgetedEntryReader({ maxUncompressedBytes });

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new ValidationError({ message: 'Backup archive is missing manifest.json.' });
  }
  const rawManifest = parseJson({
    buffer: await readEntry({ file: manifestFile }),
    path: 'manifest.json',
  });
  if (!isPlainObject(rawManifest)) {
    throw new ValidationError({ message: 'Backup archive has a malformed manifest.json (not a JSON object).' });
  }
  const manifest = rawManifest as unknown as BackupManifest;

  const { formatVersion } = manifest;
  // A checksum-clean archive can still carry a nonsense version (0, negative,
  // fractional, NaN). Require a positive integer inside the supported range so a
  // corrupt/forged manifest fails as a 422 rather than sliding through as v1.
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    throw new ValidationError({
      message: `Backup manifest declares an invalid format version (${String(formatVersion)}).`,
    });
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    throw new ValidationError({
      message: `Backup format version ${formatVersion} is newer than this app supports (max ${BACKUP_FORMAT_VERSION}). Update the app to restore it.`,
    });
  }

  // Verify every file the manifest vouches for. A missing or tampered file means
  // the upload is truncated/corrupt — safer to reject than to restore a partial.
  if (manifest.files !== undefined && !isPlainObject(manifest.files)) {
    throw new ValidationError({
      message: 'Backup archive has a malformed manifest.json (its file list is not an object).',
    });
  }
  const parsedByPath = new Map<string, unknown>();
  const manifestFiles = (manifest.files ?? {}) as Record<string, unknown>;
  for (const [path, entry] of Object.entries(manifestFiles)) {
    // The manifest is a blind cast, so a forged `files` map can carry a null or
    // non-object entry. Validate the shape before reading its checksum, else a
    // raw TypeError escapes the 422-on-corrupt path as a generic 500.
    const expectedSha = isPlainObject(entry) ? (entry as Record<string, unknown>).sha256 : undefined;
    if (typeof expectedSha !== 'string') {
      throw new ValidationError({
        message: `Backup archive has a malformed manifest entry for ${path}.`,
      });
    }
    const file = zip.file(path);
    if (!file) {
      throw new ValidationError({ message: `Backup archive is missing ${path} listed in its manifest.` });
    }
    const bytes = await readEntry({ file });
    const digest = sha256Hex({ buffer: bytes });
    if (digest !== expectedSha) {
      throw new ValidationError({ message: `Backup file ${path} failed its integrity check (checksum mismatch).` });
    }
    parsedByPath.set(path, parseJson({ buffer: bytes, path }));
  }

  const data = new Map<BackupFileName, Row[]>();
  let user: Row | null = null;
  for (const name of BACKUP_FILE_NAMES) {
    const path = `data/${name}.json`;
    if (!parsedByPath.has(path)) continue;
    const value = parsedByPath.get(path);
    if (name === 'user') {
      // A present-but-malformed user.json (checksum-clean but not an object)
      // must fail loudly here. Coercing it to null routes into analyzeArchive's
      // "contains no user record" path, which misdescribes a corrupt file.
      if (!isPlainObject(value)) {
        throw new ValidationError({
          message: `Backup file ${path} is corrupt: the user record must be a JSON object.`,
        });
      }
      user = value as Row;
      continue;
    }
    data.set(name, assertRowArray({ value, path }));
  }

  const referenceByName = new Map<string, Row[]>();
  for (const name of BACKUP_REFERENCE_FILE_NAMES) {
    const refPath = `reference/${name}.json`;
    // Apply the same shape contract as data files: a checksum-clean securities
    // catalog that parses to a non-array or carries a non-object row would leave
    // the remap empty and fail mid-transaction with an opaque constraint error.
    if (!parsedByPath.has(refPath)) {
      referenceByName.set(name, []);
      continue;
    }
    referenceByName.set(name, assertRowArray({ value: parsedByPath.get(refPath), path: refPath }));
  }

  // Data files the manifest carried that this app doesn't recognize — a backup
  // from a newer/divergent schema. Ignored on restore (warned, not fatal).
  const knownDataPaths = new Set(BACKUP_FILE_NAMES.map((n) => `data/${n}.json`));
  const unknownFileNames = [...parsedByPath.keys()]
    .filter((path) => path.startsWith('data/') && path.endsWith('.json') && !knownDataPaths.has(path))
    .map((path) => path.slice('data/'.length, -'.json'.length));

  return {
    manifest,
    data,
    user,
    reference: {
      securities: referenceByName.get('securities') ?? [],
    },
    unknownFileNames,
  };
}
