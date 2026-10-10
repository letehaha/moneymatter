/**
 * File validation utilities for statement parsing
 * Supports PDF, CSV, and TXT files
 */
import type { StatementFileType } from '@bt/shared/types';
import { logger } from '@js/utils';

/** Maximum file size (10MB) */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** PDF magic bytes signature */
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

/** PKCS#7 signature container magic bytes (ASN.1 SEQUENCE tag) */
const PKCS7_MAGIC_BYTE_START = 0x30;

/** PDF readers accept the %PDF header anywhere within this many leading bytes */
const PDF_HEADER_SEARCH_BYTES = 1024;

interface FileValidationResult {
  valid: boolean;
  /** Detected file type */
  fileType?: StatementFileType;
  /** If valid, contains the file buffer (possibly extracted from PKCS#7 for PDFs) */
  fileBuffer?: Buffer;
  error?: {
    code: 'INVALID_FILE' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_TYPE';
    message: string;
  };
}

/**
 * Try to find and extract PDF content from a PKCS#7 signed document.
 * PDFs inside PKCS#7 containers can be found by searching for the %PDF magic bytes.
 */
function extractPdfFromPkcs7({ buffer }: { buffer: Buffer }): Buffer | null {
  // Search for %PDF header in the buffer
  const pdfMagic = Buffer.from('%PDF');

  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer.subarray(i, i + 4).equals(pdfMagic)) {
      // Found PDF header, now find the end (%%EOF)
      const eofMagic = Buffer.from('%%EOF');

      // Search backwards from the end for %%EOF
      for (let j = buffer.length - 5; j > i; j--) {
        if (buffer.subarray(j, j + 5).equals(eofMagic)) {
          // Extract PDF content (include %%EOF and potential trailing newlines)
          let endPos = j + 5;
          // Include trailing whitespace/newlines that might follow %%EOF
          while (endPos < buffer.length && (buffer[endPos] === 0x0a || buffer[endPos] === 0x0d)) {
            endPos++;
          }

          logger.info('[Statement Parser] PDF found in PKCS#7 container', { start: i, end: endPos, size: endPos - i });
          return buffer.subarray(i, endPos);
        }
      }

      // If no %%EOF found, try to extract from %PDF to end
      // This is a fallback - some PDFs might have malformed endings
      logger.info('[Statement Parser] No %%EOF marker, extracting from %PDF to end of buffer');
      return buffer.subarray(i);
    }
  }

  return null;
}

/**
 * Detect if buffer contains valid text (for CSV/TXT detection)
 */
function isValidTextContent({ buffer }: { buffer: Buffer }): boolean {
  // Check first chunk for text-like content
  const sampleSize = Math.min(buffer.length, 1000);
  const sample = buffer.subarray(0, sampleSize);

  // Count printable ASCII and common text characters
  let printableCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i]!;
    // Printable ASCII (32-126), tab (9), newline (10), carriage return (13)
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      printableCount++;
    }
  }

  // If >90% printable, treat as text
  return printableCount / sample.length > 0.9;
}

/**
 * Detect file type from content
 */
function detectFileType({ buffer }: { buffer: Buffer }): StatementFileType | null {
  // Check for PDF
  if (buffer.length >= 4) {
    const header = buffer.subarray(0, 4);
    if (header.equals(PDF_MAGIC_BYTES)) {
      return 'pdf';
    }

    // Check for PKCS#7 (might contain PDF)
    if (buffer[0] === PKCS7_MAGIC_BYTE_START) {
      const extractedPdf = extractPdfFromPkcs7({ buffer });
      if (extractedPdf) {
        return 'pdf';
      }
    }
  }

  // Check for text content (CSV or TXT)
  if (isValidTextContent({ buffer })) {
    // Try to detect CSV by looking for common delimiters
    const textSample = buffer.subarray(0, Math.min(buffer.length, 2000)).toString('utf8');
    const lines = textSample.split(/\r?\n/).filter((line) => line.trim());

    if (lines.length >= 2) {
      // Check for consistent delimiter usage (comma, semicolon, tab)
      const delimiters = [',', ';', '\t'];
      for (const delimiter of delimiters) {
        const firstLineCount = (lines[0]?.split(delimiter).length ?? 0) - 1;
        const secondLineCount = (lines[1]?.split(delimiter).length ?? 0) - 1;

        // If both lines have same number of delimiters and > 0, likely CSV
        if (firstLineCount > 0 && firstLineCount === secondLineCount) {
          return 'csv';
        }
      }
    }

    // Default to txt for other text content
    return 'txt';
  }

  return null;
}

/**
 * Validate a file buffer for statement parsing
 * - Detects file type (PDF, CSV, TXT)
 * - Checks file size
 * - Extracts PDF from PKCS#7 signed containers if needed
 */
export function validateFileBuffer({ buffer }: { buffer: Buffer }): FileValidationResult {
  // Check file size
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    logger.info('Import file validation failed', {
      code: 'FILE_TOO_LARGE',
      sizeBytes: buffer.length,
      maxBytes: MAX_FILE_SIZE_BYTES,
    });

    return {
      valid: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
      },
    };
  }

  // Check minimum size
  if (buffer.length < 10) {
    logger.info('Import file validation failed', { code: 'INVALID_FILE', sizeBytes: buffer.length });

    return {
      valid: false,
      error: {
        code: 'INVALID_FILE',
        message: 'File is too small to be valid',
      },
    };
  }

  // Check for PDF magic bytes
  const header = buffer.subarray(0, 4);
  if (header.equals(PDF_MAGIC_BYTES)) {
    return {
      valid: true,
      fileType: 'pdf',
      fileBuffer: buffer,
    };
  }

  // Check for PKCS#7 signed document (might contain PDF)
  if (buffer[0] === PKCS7_MAGIC_BYTE_START) {
    logger.info('[Statement Parser] PKCS#7 signed document detected, extracting PDF');

    const extractedPdf = extractPdfFromPkcs7({ buffer });

    if (extractedPdf) {
      const extractedHeader = extractedPdf.subarray(0, 4);
      if (extractedHeader.equals(PDF_MAGIC_BYTES)) {
        logger.info('[Statement Parser] PDF extracted from PKCS#7 container');
        return {
          valid: true,
          fileType: 'pdf',
          fileBuffer: extractedPdf,
        };
      }
    }
  }

  // PDF cross-reference offsets are relative to the header, so the parser
  // must receive a buffer that starts at %PDF.
  const pdfHeaderOffset = buffer.subarray(0, PDF_HEADER_SEARCH_BYTES).indexOf(PDF_MAGIC_BYTES);
  if (pdfHeaderOffset > 0) {
    return {
      valid: true,
      fileType: 'pdf',
      fileBuffer: buffer.subarray(pdfHeaderOffset),
    };
  }

  // Try to detect text-based formats
  const detectedType = detectFileType({ buffer });

  if (detectedType === 'csv' || detectedType === 'txt') {
    return {
      valid: true,
      fileType: detectedType,
      fileBuffer: buffer,
    };
  }

  logger.info('Import file validation failed', { code: 'UNSUPPORTED_TYPE', sizeBytes: buffer.length });

  return {
    valid: false,
    error: {
      code: 'UNSUPPORTED_TYPE',
      message: 'Unsupported file type. Please upload a PDF, CSV, or TXT file.',
    },
  };
}
