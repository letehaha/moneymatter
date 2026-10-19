import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const WEBP_1X1_BASE64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

export const PNG_1X1_BYTES = Buffer.from(PNG_1X1_BASE64, 'base64');
export const WEBP_1X1_BYTES = Buffer.from(WEBP_1X1_BASE64, 'base64');

export const PNG_1X1_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`;
export const WEBP_1X1_DATA_URL = `data:image/webp;base64,${WEBP_1X1_BASE64}`;

/** A real PNG padded to one byte past the decoded limit, still under the schema's length cap. */
export const OVERSIZED_PNG_DATA_URL = `data:image/png;base64,${Buffer.concat([
  PNG_1X1_BYTES,
  Buffer.alloc(LOGO_IMAGE_MAX_BYTES + 1 - PNG_1X1_BYTES.length),
]).toString('base64')}`;

export const TEXT_AS_PNG_DATA_URL = `data:image/png;base64,${Buffer.from('definitely not an image').toString('base64')}`;
