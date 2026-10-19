/**
 * File validation utilities for statement parsing
 * Validates file content using magic bytes to prevent renamed/malicious files
 */

/** Per-file. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const SUPPORTED_EXTENSIONS = ['.pdf', '.csv', '.txt', ...IMAGE_EXTENSIONS];

export const isImageFile = ({ file }: { file: File }): boolean =>
  IMAGE_EXTENSIONS.includes('.' + (file.name.toLowerCase().split('.').pop() || ''));

// Magic bytes for file type detection
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46]; // %PDF
const PKCS7_MAGIC_BYTE = 0x30; // ASN.1 SEQUENCE (signed PDF container)
/** PDF readers accept the %PDF header anywhere within this many leading bytes. */
const PDF_HEADER_SEARCH_BYTES = 1024;
const HEADER_HEX_BYTES = 16;

const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff];
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];
const RIFF_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46]; // RIFF
const WEBP_MAGIC_BYTES = [0x57, 0x45, 0x42, 0x50]; // WEBP, at offset 8

export type FileRejectionReason =
  | 'unsupported_extension'
  | 'too_large'
  | 'invalid_pdf'
  | 'invalid_text'
  | 'invalid_image'
  | 'unreadable_image'
  | 'unreadable';

type FileValidationResult =
  | { valid: true }
  | {
      valid: false;
      /** The caller words the message from this, so it reads in the user's language. */
      reason: FileRejectionReason;
      /** Leading bytes of the file, set when a content check failed. */
      headerHex?: string;
    };

const toHex = ({ bytes }: { bytes: Uint8Array }): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Read the first N bytes of a file for magic byte detection
 */
async function readFileHeader({ file, bytes }: { file: File; bytes: number }): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Check if the PDF magic bytes occur anywhere in the given bytes
 */
function containsPdfMagicBytes({ header }: { header: Uint8Array }): boolean {
  for (let i = 0; i + PDF_MAGIC_BYTES.length <= header.length; i++) {
    if (PDF_MAGIC_BYTES.every((byte, j) => header[i + j] === byte)) return true;
  }
  return false;
}

function hasBytesAt({ header, bytes, offset = 0 }: { header: Uint8Array; bytes: number[]; offset?: number }): boolean {
  return bytes.every((byte, i) => header[offset + i] === byte);
}

function isImageHeader({ header }: { header: Uint8Array }): boolean {
  return (
    hasBytesAt({ header, bytes: JPEG_MAGIC_BYTES }) ||
    hasBytesAt({ header, bytes: PNG_MAGIC_BYTES }) ||
    (hasBytesAt({ header, bytes: RIFF_MAGIC_BYTES }) && hasBytesAt({ header, bytes: WEBP_MAGIC_BYTES, offset: 8 }))
  );
}

/**
 * Check if file appears to be valid text content (for CSV/TXT)
 * Reads a sample and checks if majority are printable characters
 */
async function isValidTextContent({ file }: { file: File }): Promise<boolean> {
  const sampleSize = Math.min(file.size, 1000);
  const slice = file.slice(0, sampleSize);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let printableCount = 0;
  for (const byte of bytes) {
    // Printable ASCII (32-126), tab (9), newline (10), carriage return (13)
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      printableCount++;
    }
  }

  // If >90% printable, treat as valid text
  return printableCount / bytes.length > 0.9;
}

/**
 * Validate file content matches the expected type based on extension.
 * This prevents users from uploading renamed files (e.g., .exe renamed to .pdf)
 */
async function validateFileContent({ file }: { file: File }): Promise<FileValidationResult> {
  const ext = '.' + (file.name.toLowerCase().split('.').pop() || '');
  const header = await readFileHeader({ file, bytes: PDF_HEADER_SEARCH_BYTES });
  const headerHex = toHex({ bytes: header.subarray(0, HEADER_HEX_BYTES) });

  if (ext === '.pdf') {
    // Check for PDF magic bytes or PKCS#7 container (signed PDF)
    const isPdf = containsPdfMagicBytes({ header });
    const isPkcs7 = header[0] === PKCS7_MAGIC_BYTE;

    if (!isPdf && !isPkcs7) {
      return {
        valid: false,
        reason: 'invalid_pdf',
        headerHex,
      };
    }
  } else if (IMAGE_EXTENSIONS.includes(ext)) {
    if (!isImageHeader({ header })) {
      return {
        valid: false,
        reason: 'invalid_image',
        headerHex,
      };
    }
  } else if (ext === '.csv' || ext === '.txt') {
    // For text files, verify content is actually text
    const isText = await isValidTextContent({ file });

    if (!isText) {
      return {
        valid: false,
        reason: 'invalid_text',
        headerHex,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a file for statement upload (extension, size, and content)
 */
export async function validateStatementFile({ file }: { file: File }): Promise<FileValidationResult> {
  // 1. Check file extension first (quick check)
  const ext = '.' + (file.name.toLowerCase().split('.').pop() || '');
  const isValidExtension = SUPPORTED_EXTENSIONS.includes(ext);

  if (!isValidExtension) {
    return {
      valid: false,
      reason: 'unsupported_extension',
    };
  }

  // 2. Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      reason: 'too_large',
    };
  }

  // 3. Validate actual file content matches extension (prevents renamed files)
  return validateFileContent({ file });
}
