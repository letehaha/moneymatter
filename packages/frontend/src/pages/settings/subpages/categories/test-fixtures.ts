import { type FormattedCategory } from '@/common/types';
import { CATEGORY_TYPES, type RecordId } from '@bt/shared/types';

export const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}` as RecordId;

export const category = ({
  id,
  parentId = null,
  type = CATEGORY_TYPES.custom,
  subCategories = [],
}: {
  id: number;
  parentId?: number | null;
  type?: CATEGORY_TYPES;
  subCategories?: FormattedCategory[];
}): FormattedCategory => ({
  id: uuid(id),
  key: null,
  color: '#ffffff',
  name: `category-${id}`,
  icon: null,
  userId: 1,
  parentId: parentId === null ? null : uuid(parentId),
  type,
  defaultTagIds: [],
  applyDefaultTagsOnAiCategorization: false,
  subCategories,
});
