import { LOGO_IMAGE_MAX_BYTES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { deleteObject, getObjectStream, putObject } from '@services/attachments/storage';
import { runAfterCommit } from '@services/common/run-after-commit';
import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';

export const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const logoImageKey = ({ id }: { id: string }) => `logos/${id}`;

/** The shape `logoImageKey` produces; captures the image id. */
export const LOGO_IMAGE_KEY_PATTERN = /^logos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const sniffImageType = ({ bytes }: { bytes: Buffer }): string | null => {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

const writeLogoImage = async ({ body, contentType }: { body: Buffer; contentType: string }) => {
  const id = randomUUID();
  await putObject({ key: logoImageKey({ id }), body, contentType });
  return { id };
};

export const storeLogoImage = async ({ dataUrl }: { dataUrl: string }): Promise<{ id: string }> => {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new ValidationError({ message: t({ key: 'logoImages.invalidImage' }) });

  const [, declaredType, base64] = match as unknown as [string, string, string];
  const body = Buffer.from(base64, 'base64');
  if (body.length > LOGO_IMAGE_MAX_BYTES) {
    throw new ValidationError({ message: t({ key: 'logoImages.tooLarge' }) });
  }
  if (sniffImageType({ bytes: body }) !== declaredType) {
    throw new ValidationError({ message: t({ key: 'logoImages.invalidImage' }) });
  }

  return writeLogoImage({ body, contentType: declaredType });
};

export const readLogoImage = async ({ id }: { id: string }): Promise<{ body: Buffer; contentType: string }> => {
  let body: Buffer;
  try {
    body = await buffer(await getObjectStream({ key: logoImageKey({ id }) }));
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new NotFoundError({ message: t({ key: 'logoImages.notFound' }) });
    }
    throw error;
  }

  const contentType = sniffImageType({ bytes: body });
  if (!contentType) {
    logger.error(
      { message: 'Stored logo image has no recognizable image signature' },
      { code: 'LOGO_IMAGE_UNKNOWN_TYPE', logoImageId: id },
    );
  }
  return { body, contentType: contentType ?? 'application/octet-stream' };
};

const copyLogoImage = async ({ id }: { id: string }): Promise<{ id: string }> => {
  const { body, contentType } = await readLogoImage({ id });
  return writeLogoImage({ body, contentType });
};

/** Copies the image when its blob exists; a missing blob yields null. */
export const copyLogoImageIfPresent = async ({ id }: { id: string | null }): Promise<string | null> => {
  if (!id) return null;
  try {
    return (await copyLogoImage({ id })).id;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    logger.warn('Copying a logo image whose blob is missing', { logoImageId: id });
    return null;
  }
};

/** Best effort, never throws; inside a transaction it waits for the commit. */
export const deleteLogoImage = ({ id }: { id: string }): Promise<void> =>
  runAfterCommit({
    fn: async () => {
      try {
        await deleteObject({ key: logoImageKey({ id }) });
      } catch (error) {
        logger.error(
          { message: 'Failed to delete logo image blob', error: error as Error },
          { code: 'LOGO_IMAGE_DELETE_FAILED', logoImageId: id },
        );
      }
    },
  });
