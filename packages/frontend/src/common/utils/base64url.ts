const BASE64URL_PADDING_UNIT = 4;

/** Decodes a base64url string (a VAPID public key) into the bytes `pushManager.subscribe` expects. */
export const urlBase64ToUint8Array = ({ value }: { value: string }): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat(
    (BASE64URL_PADDING_UNIT - (value.length % BASE64URL_PADDING_UNIT)) % BASE64URL_PADDING_UNIT,
  );
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
};

/** Encodes bytes as unpadded base64url, the form the VAPID key and subscription keys travel in. */
export const arrayBufferToBase64Url = ({ buffer }: { buffer: ArrayBuffer | ArrayBufferView }): string => {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
