import { i18nextReady, t } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';
import JSZip from 'jszip';

import { sha256Hex } from '../sha256';
import { loadBackupArchive } from './load-archive';

/**
 * Small budget so a few kilobytes of highly-compressible payload already blow it,
 * standing in for the 1 GiB production ceiling without materializing a real bomb.
 */
const SMALL_BUDGET = 1024;

/**
 * Build a loadable, otherwise-valid backup zip carrying a single data file with a
 * correct checksum, so the only thing a test can push out of bounds is its size.
 */
async function buildArchive({ content }: { content: string }): Promise<Buffer> {
  const dataBuffer = Buffer.from(content, 'utf8');
  const manifest = {
    formatVersion: 1,
    files: { 'data/transactions.json': { rows: 1, sha256: sha256Hex({ buffer: dataBuffer }) } },
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('data/transactions.json', dataBuffer);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Rewrite one entry's uncompressed-size field in the zip's central directory so it
 * understates the real size. JSZip trusts the central directory for
 * `uncompressedSize`, so this fools the declared-size preflight while the actual
 * DEFLATE stream still inflates to its true length — modelling a forged zip bomb.
 */
function understateCentralDirSize({
  buffer,
  fileName,
  size,
}: {
  buffer: Buffer;
  fileName: string;
  size: number;
}): void {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;

  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('End-of-central-directory record not found');

  let offset = buffer.readUInt32LE(eocd + 16);
  const totalRecords = buffer.readUInt16LE(eocd + 10);
  for (let n = 0; n < totalRecords; n++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error('Central-directory record signature mismatch');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === fileName) {
      buffer.writeUInt32LE(size, offset + 24);
      return;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Central-directory entry not found for ${fileName}`);
}

/**
 * Build a loadable, checksum-clean backup zip from an arbitrary set of files, so a
 * test can drop in a deliberately malformed data/reference/user file and drive the
 * shape guards. Each file's SHA-256 is computed into the manifest so it passes the
 * integrity gate and reaches the post-checksum shape checks.
 */
async function buildArchiveFromFiles({ files }: { files: Record<string, string> }): Promise<Buffer> {
  const manifestFiles: Record<string, { sha256: string }> = {};
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    const buffer = Buffer.from(content, 'utf8');
    manifestFiles[path] = { sha256: sha256Hex({ buffer }) };
    zip.file(path, buffer);
  }
  zip.file('manifest.json', JSON.stringify({ formatVersion: 1, files: manifestFiles }));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

beforeAll(async () => {
  await i18nextReady;
});

describe('loadBackupArchive file-shape guards', () => {
  it('rejects a data file whose array carries a non-object element', async () => {
    const buffer = await buildArchiveFromFiles({ files: { 'data/transactions.json': '[null]' } });

    await expect(loadBackupArchive({ fileContent: buffer.toString('base64') })).rejects.toThrow(
      t({ key: 'backup.restore.errors.rowNotObject', variables: { path: 'data/transactions.json' } }),
    );
  });

  it('rejects a securities reference file that parses to a non-array', async () => {
    const buffer = await buildArchiveFromFiles({ files: { 'reference/securities.json': '{}' } });

    await expect(loadBackupArchive({ fileContent: buffer.toString('base64') })).rejects.toThrow(
      t({ key: 'backup.restore.errors.rowsNotArray', variables: { path: 'reference/securities.json' } }),
    );
  });

  it('rejects a securities reference file whose array carries a non-object element', async () => {
    const buffer = await buildArchiveFromFiles({ files: { 'reference/securities.json': '[null]' } });

    await expect(loadBackupArchive({ fileContent: buffer.toString('base64') })).rejects.toThrow(
      t({ key: 'backup.restore.errors.rowNotObject', variables: { path: 'reference/securities.json' } }),
    );
  });

  it('rejects a present-but-malformed user file with a corrupt-record message', async () => {
    const buffer = await buildArchiveFromFiles({ files: { 'data/user.json': '42' } });

    await expect(loadBackupArchive({ fileContent: buffer.toString('base64') })).rejects.toThrow(
      t({ key: 'backup.restore.errors.userNotObject', variables: { path: 'data/user.json' } }),
    );
  });

  it('leaves user null when user.json is absent entirely', async () => {
    const buffer = await buildArchiveFromFiles({ files: { 'data/transactions.json': '[]' } });

    const archive = await loadBackupArchive({ fileContent: buffer.toString('base64') });

    expect(archive.user).toBeNull();
  });
});

describe('loadBackupArchive uncompressed-size budget', () => {
  it('rejects up front when the archive honestly declares more bytes than the budget', async () => {
    // ~4 KB uncompressed but trivially compressible, so the central directory
    // reports the oversize truthfully and the preflight fails before any read.
    const buffer = await buildArchive({ content: 'x'.repeat(4096) });

    await expect(
      loadBackupArchive({ fileContent: buffer.toString('base64'), maxUncompressedBytes: SMALL_BUDGET }),
    ).rejects.toThrow(t({ key: 'backup.restore.errors.archiveTooLarge' }));
  });

  it('rejects a forged archive that understates its declared sizes as a clean 422', async () => {
    const buffer = await buildArchive({ content: 'x'.repeat(4096) });
    // Forge the central directory to claim the data file is a single byte so the
    // declared-size total fits the budget and the up-front preflight passes.
    understateCentralDirSize({ buffer, fileName: 'data/transactions.json', size: 1 });

    // Decompressing the real stream trips JSZip's own size-integrity probe, which the
    // budgeted reader wraps into a ValidationError (422) rather than letting the raw
    // error escape as a generic 500.
    await expect(
      loadBackupArchive({ fileContent: buffer.toString('base64'), maxUncompressedBytes: SMALL_BUDGET }),
    ).rejects.toThrow(t({ key: 'backup.restore.errors.archiveCorrupt' }));
  });

  it('accepts an archive whose uncompressed contents fit the budget', async () => {
    const buffer = await buildArchive({ content: '[]' });

    const archive = await loadBackupArchive({
      fileContent: buffer.toString('base64'),
      maxUncompressedBytes: SMALL_BUDGET,
    });

    expect(archive.manifest.formatVersion).toBe(1);
  });
});
