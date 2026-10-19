import {
  OFX_MAX_FILE_BYTES,
  OFX_MAX_ROWS,
  type OfxParseAccount,
  type OfxParseResult,
  type OfxParseTransaction,
  type OfxParseWarning,
  type OfxStatementType,
} from '@bt/shared/types';

export { OFX_MAX_FILE_BYTES, OFX_MAX_ROWS };

export type OfxFormatVersion = '1.x' | '2.x';
export type { OfxParseAccount, OfxParseResult, OfxParseTransaction, OfxParseWarning, OfxStatementType };

export interface OfxHeader {
  charset: string;
  compression: 'NONE';
  data: 'OFXSGML' | 'OFXXML';
  encoding: string;
  headerVersion: string;
  version: string;
}

export interface OfxDecodedFile {
  body: string;
  formatVersion: OfxFormatVersion;
}

/** `key` is a backend i18n key under `ofxImport.errors`; the upload controller translates it with `params`. */
export class OfxParseError extends Error {
  constructor({ code, key, params }: { code: string; key: string; params?: Record<string, string | number> }) {
    super(key);
    this.name = 'OfxParseError';
    this.code = code;
    this.key = key;
    this.params = params;
  }

  readonly code: string;
  readonly key: string;
  readonly params?: Record<string, string | number>;
}
