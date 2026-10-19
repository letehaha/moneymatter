import { type FormattedCategory } from '@/common/types';
import { CATEGORY_TYPES } from '@bt/shared/types';

/** Only the fields drop validation reads; callers can pass a stub for a not-yet-created category. */
export type DraggedCategory = Pick<FormattedCategory, 'id' | 'parentId' | 'subCategories'>;

const subtreeHeight = ({ category }: { category: DraggedCategory }): number =>
  1 + Math.max(0, ...category.subCategories.map((child) => subtreeHeight({ category: child })));

const containsCategory = ({ parent, categoryId }: { parent: DraggedCategory; categoryId: string }): boolean =>
  parent.subCategories.some((child) => child.id === categoryId || containsCategory({ parent: child, categoryId }));

export type CategoryDropError =
  | 'self'
  | 'current-parent'
  | 'inside-itself'
  | 'internal-target'
  | 'too-deep'
  | 'children-too-deep'
  | 'already-top-level';

/** `target: null` is the top-level drop zone; a real target requires its depth (roots count as 1). */
type DropTarget = { target: null } | { target: FormattedCategory; targetDepth: number };

/**
 * Returns why the drop is forbidden, or `null` when it is allowed.
 */
export const categoryDropError = (
  params: { dragged: DraggedCategory; maxNesting: number } & DropTarget,
): CategoryDropError | null => {
  const { dragged, maxNesting } = params;

  if (params.target === null) return dragged.parentId === null ? 'already-top-level' : null;

  const { target, targetDepth } = params;

  if (target.type === CATEGORY_TYPES.internal) return 'internal-target';
  if (target.id === dragged.id) return 'self';
  if (dragged.parentId === target.id) return 'current-parent';
  if (containsCategory({ parent: dragged, categoryId: target.id })) return 'inside-itself';

  if (targetDepth + subtreeHeight({ category: dragged }) > maxNesting) {
    // 'too-deep': the target row itself can't take any child. 'children-too-deep': it
    // could, but the dragged subtree is too tall to fit under it.
    return targetDepth + 1 > maxNesting ? 'too-deep' : 'children-too-deep';
  }

  return null;
};
