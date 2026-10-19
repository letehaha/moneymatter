import type { EntityLogoPayload, EntityLogoWritePayload } from '@bt/shared/types';
import { deleteLogoImage, storeLogoImage } from '@services/logo-images/logo-images.service';

import { applyManualLogoPatch } from './apply-manual-logo-patch';

// Stands in for the uploaded image's id so the slot rules run before anything is stored.
const PENDING_IMAGE_ID = 'pending-upload';

/**
 * Resolves a client logo write into logo columns, storing an uploaded `logoImage`
 * once the patch rules accept it. A stored image the patch stops referencing is
 * deleted after the surrounding transaction commits.
 */
export const applyLogoWrite = async ({
  write,
  stored = {},
}: {
  write: EntityLogoWritePayload;
  stored?: EntityLogoPayload;
}): Promise<EntityLogoPayload> => {
  const { logoImage, ...columns } = write;
  const patch = applyManualLogoPatch({
    patch: { ...columns, logoImageId: logoImage == null ? logoImage : PENDING_IMAGE_ID },
    stored,
  });

  if (logoImage != null) {
    patch.logoImageId = (await storeLogoImage({ dataUrl: logoImage })).id;
  }

  const storedImageId = stored.logoImageId ?? null;
  if (storedImageId !== null && patch.logoImageId !== undefined && patch.logoImageId !== storedImageId) {
    await deleteLogoImage({ id: storedImageId });
  }

  return patch;
};
