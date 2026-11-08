declare module 'http_ece' {
  interface EceParams {
    version?: 'aes128gcm' | 'aesgcm';
    /** The receiver's ECDH key pair, for Web Push decryption */
    privateKey?: import('node:crypto').ECDH;
    authSecret?: Buffer | string;
    [key: string]: unknown;
  }

  export function decrypt(buffer: Buffer, params: EceParams): Buffer;
  export function encrypt(buffer: Buffer, params: EceParams): Buffer;
}
