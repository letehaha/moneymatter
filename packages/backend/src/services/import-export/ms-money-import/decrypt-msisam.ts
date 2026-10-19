/**
 * Decrypts a Microsoft Money (.mny) database into a plain Jet4 buffer that a
 * generic MDB reader can open.
 *
 * A .mny file is a Jet4 database with Microsoft's "MSISAM" engine marker, and
 * every one of them is encrypted — files with no password simply key off an
 * empty password. Only pages 1..14 are enciphered (they hold the system
 * catalog); page 0 and everything past page 14 are already plaintext, so this
 * runs in constant time regardless of file size.
 *
 * The algorithm mirrors Jackcess's `MSISAMCryptCodecHandler` (Apache-2.0), the
 * de-facto reference implementation for this format.
 */
import type { MsMoneyEncryption } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import crypto from 'node:crypto';

const PAGE_SIZE = 4096;
const ENGINE_NAME_OFFSET = 0x4;
const ENGINE_NAME_LENGTH = 0xf;
const MSISAM_ENGINE_NAME = 'MSISAM Database';

const SALT_OFFSET = 0x72;
const CRYPT_CHECK_START = 0x2e9;
const ENCRYPTION_FLAGS_OFFSET = 0x298;
const SALT_LENGTH = 0x4;
const PASSWORD_LENGTH = 0x28;
const PASSWORD_DIGEST_LENGTH = 0x10;
const USE_SHA1_FLAG = 0x20;
const NEW_ENCRYPTION_FLAG = 0x6;
const MAX_ENCRYPTED_PAGE = 0xe;

const OFFSET_PASSWORD = 66;
const SIZE_PASSWORD = 40;
const OFFSET_HEADER_DATE = 114;
const TRAILING_PASSWORD_LENGTH = 20;
const LEGACY_KEY_LENGTH = 4;

/**
 * Jet obfuscates part of page 0 with this fixed XOR mask. The encryption salt
 * and password material live inside the masked range, so the header must be
 * unmasked before any key can be derived from it.
 */
// prettier-ignore
const HEADER_MASK = Buffer.from([
  0xb5, 0x6f, 0x03, 0x62, 0x61, 0x08, 0xc2, 0x55, 0xeb, 0xa9, 0x67, 0x72,
  0x43, 0x3f, 0x00, 0x9c, 0x7a, 0x9f, 0x90, 0xff, 0x80, 0x9a, 0x31, 0xc5,
  0x79, 0xba, 0xed, 0x30, 0xbc, 0xdf, 0xcc, 0x9d, 0x63, 0xd9, 0xe4, 0xc3,
  0x7b, 0x42, 0xfb, 0x8a, 0xbc, 0x4e, 0x86, 0xfb, 0xec, 0x37, 0x5d, 0x44,
  0x9c, 0xfa, 0xc6, 0x5e, 0x28, 0xe6, 0x13, 0xb6, 0x8a, 0x60, 0x54, 0x94,
  0x7b, 0x36, 0xf5, 0x72, 0xdf, 0xb1, 0x77, 0xf4, 0x13, 0x43, 0xcf, 0xaf,
  0xb1, 0x33, 0x34, 0x61, 0x79, 0x5b, 0x92, 0xb5, 0x7c, 0x2a, 0x05, 0xf1,
  0x7c, 0x99, 0x01, 0x1b, 0x98, 0xfd, 0x12, 0x4f, 0x4a, 0x94, 0x6c, 0x3e,
  0x60, 0x26, 0x5f, 0x95, 0xf8, 0xd0, 0x89, 0x24, 0x85, 0x67, 0xc6, 0x1f,
  0x27, 0x44, 0xd2, 0xee, 0xcf, 0x65, 0xed, 0xff, 0x07, 0xc7, 0x46, 0xa1,
  0x78, 0x16, 0x0c, 0xed, 0xe9, 0x2d, 0x62, 0xd4,
]);
const HEADER_MASK_OFFSET = 0x18;

export type { MsMoneyEncryption };

interface DecryptMsisamResult {
  /** Plaintext Jet4 database, ready for an MDB reader. */
  buffer: Buffer;
  encryption: MsMoneyEncryption;
  /** True when the file carried password check bytes that matched. A file with
   *  no password set has no check bytes, so this stays false for those. */
  passwordVerified: boolean;
}

/** Node dropped RC4 from its OpenSSL cipher list, so the stream cipher is inline. */
function rc4({ key, data }: { key: Buffer; data: Buffer }): Buffer {
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) state[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) & 0xff;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }

  const out = Buffer.allocUnsafe(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + state[a]!) & 0xff;
    [state[a], state[b]] = [state[b]!, state[a]!];
    out[k] = data[k]! ^ state[(state[a]! + state[b]!) & 0xff]!;
  }
  return out;
}

function unmaskHeader({ page }: { page: Buffer }): Buffer {
  const out = Buffer.from(page);
  for (let i = 0; i < HEADER_MASK.length; i++) {
    out[HEADER_MASK_OFFSET + i] = out[HEADER_MASK_OFFSET + i]! ^ HEADER_MASK[i]!;
  }
  return out;
}

function fixToLength({ bytes, length }: { bytes: Buffer; length: number }): Buffer {
  if (bytes.length === length) return bytes;
  const out = Buffer.alloc(length);
  bytes.copy(out, 0, 0, Math.min(bytes.length, length));
  return out;
}

/** Derives the per-page key by XORing the page number into the base key. */
function applyPageNumber({ key, offset, pageNumber }: { key: Buffer; offset: number; pageNumber: number }): Buffer {
  const out = Buffer.from(key);
  out.writeInt32LE(pageNumber, offset);
  for (let i = offset; i < offset + 4; i++) out[i] = out[i]! ^ key[i]!;
  return out;
}

function isBlank({ bytes }: { bytes: Buffer }): boolean {
  return bytes.every((byte) => byte === 0);
}

function createPasswordDigest({ header, password }: { header: Buffer; password: string | null }): Buffer {
  const useSha1 = (header[ENCRYPTION_FLAGS_OFFSET]! & USE_SHA1_FLAG) !== 0;

  // Jet hashes a fixed-width buffer holding the uppercased password as UTF-16LE.
  const passwordBytes = Buffer.alloc(PASSWORD_LENGTH);
  if (password) {
    const encoded = Buffer.from(password.toUpperCase(), 'utf16le');
    encoded.copy(passwordBytes, 0, 0, Math.min(PASSWORD_LENGTH, encoded.length));
  }

  const digest = crypto
    .createHash(useSha1 ? 'sha1' : 'md5')
    .update(passwordBytes)
    .digest();
  return fixToLength({ bytes: digest, length: PASSWORD_DIGEST_LENGTH });
}

/** Folds `hashData` into a 4-byte key, one byte at a time. */
function hashSalt({ salt, hashData }: { salt: Buffer; hashData: Buffer }): void {
  let hash = salt.readInt32LE(0);
  for (let pos = 0; pos < hashData.length; pos++) {
    hash ^= (hashData[pos]! & 0xff) << (pos % 0x18);
  }
  salt.writeInt32LE(hash | 0, 0);
}

/**
 * Files written before Money 2002 use a Jet-style key derived entirely from the
 * header — the user's password plays no part in decryption there.
 */
function getLegacyDecryptionKey({ header }: { header: Buffer }): Buffer {
  const key = Buffer.from(header.subarray(SALT_OFFSET, SALT_OFFSET + LEGACY_KEY_LENGTH));

  const fullHashData = Buffer.from(header.subarray(OFFSET_PASSWORD, OFFSET_PASSWORD + SIZE_PASSWORD * 2));

  // The mask is derived from the database's creation date.
  const passwordMask = Buffer.alloc(4);
  passwordMask.writeInt32LE(Math.trunc(header.readDoubleLE(OFFSET_HEADER_DATE)) | 0, 0);
  for (let i = 0; i < SIZE_PASSWORD; i++) fullHashData[i] = fullHashData[i]! ^ passwordMask[i % passwordMask.length]!;
  const trailingOffset = fullHashData.length - TRAILING_PASSWORD_LENGTH;
  for (let i = 0; i < TRAILING_PASSWORD_LENGTH; i++) {
    fullHashData[trailingOffset + i] = fullHashData[trailingOffset + i]! ^ passwordMask[i % passwordMask.length]!;
  }

  const hashData = Buffer.alloc(SIZE_PASSWORD);
  for (let pos = 0; pos < SIZE_PASSWORD; pos++) hashData[pos] = fullHashData[pos * 2]!;

  hashSalt({ salt: key, hashData });
  hashSalt({ salt: key, hashData: header.subarray(ENGINE_NAME_OFFSET, ENGINE_NAME_OFFSET + ENGINE_NAME_LENGTH) });

  return key;
}

/** True when the buffer looks like a Money database, before any decryption. */
export function isMsMoneyFile({ buffer }: { buffer: Buffer }): boolean {
  if (buffer.length < PAGE_SIZE) return false;
  return buffer.toString('latin1', ENGINE_NAME_OFFSET, ENGINE_NAME_OFFSET + ENGINE_NAME_LENGTH) === MSISAM_ENGINE_NAME;
}

/**
 * Returns a plaintext copy of the database. Throws `ValidationError` when the
 * file is not a Money database or the password is wrong/missing — both are user
 * mistakes the wizard reports rather than server faults.
 */
export function decryptMsisam({
  buffer,
  password = null,
}: {
  buffer: Buffer;
  password?: string | null;
}): DecryptMsisamResult {
  if (!isMsMoneyFile({ buffer })) {
    throw new ValidationError({
      message: t({ key: 'importExport.msMoney.notMsMoneyFile' }),
    });
  }

  const header = unmaskHeader({ page: buffer.subarray(0, PAGE_SIZE) });
  const flags = header[ENCRYPTION_FLAGS_OFFSET]!;
  const usesNewEncryption = (flags & NEW_ENCRYPTION_FLAG) !== 0;

  let baseKey: Buffer;
  let keyOffset: number;
  let passwordVerified = false;
  let encryption: MsMoneyEncryption;

  if (usesNewEncryption) {
    const salt = header.subarray(SALT_OFFSET, SALT_OFFSET + 8);
    const baseSalt = salt.subarray(0, SALT_LENGTH);
    const passwordDigest = createPasswordDigest({ header, password });

    // The file stores four check bytes that decrypt to the salt prefix under the
    // correct password. Files without a password leave them zeroed.
    const checkOffset = header[SALT_OFFSET]!;
    const checkBytes = header.subarray(CRYPT_CHECK_START + checkOffset, CRYPT_CHECK_START + checkOffset + 4);
    if (!isBlank({ bytes: checkBytes })) {
      const decrypted = rc4({ key: Buffer.concat([passwordDigest, salt]), data: checkBytes });
      if (!decrypted.equals(baseSalt)) {
        throw new ValidationError({
          message: t({
            key: password ? 'importExport.msMoney.incorrectPassword' : 'importExport.msMoney.passwordRequired',
          }),
        });
      }
      passwordVerified = true;
    }

    baseKey = Buffer.concat([passwordDigest, baseSalt]);
    keyOffset = PASSWORD_DIGEST_LENGTH;
    encryption = (flags & USE_SHA1_FLAG) !== 0 ? 'new-sha1' : 'new-md5';
  } else {
    baseKey = getLegacyDecryptionKey({ header });
    keyOffset = 0;
    encryption = 'legacy-jet';
  }

  const out = Buffer.from(buffer);
  const lastPage = Math.min(MAX_ENCRYPTED_PAGE, Math.floor(buffer.length / PAGE_SIZE) - 1);
  for (let page = 1; page <= lastPage; page++) {
    const start = page * PAGE_SIZE;
    const key = applyPageNumber({ key: baseKey, offset: keyOffset, pageNumber: page });
    rc4({ key, data: buffer.subarray(start, start + PAGE_SIZE) }).copy(out, start);
  }

  return { buffer: out, encryption, passwordVerified };
}
