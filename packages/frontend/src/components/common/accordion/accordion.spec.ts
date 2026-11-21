import { type CategoryDropPosition, type FormattedCategory } from '@/common/types';
import Accordion from '@/components/common/accordion/accordion.vue';
import commonEn from '@/i18n/locales/chunks/en/common.json';
import { category } from '@/pages/settings/subpages/categories/test-fixtures';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { DOMWrapper, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: commonEn } });

const grandChild = category({ id: 3, parentId: 2 });
const child = category({ id: 2, parentId: 1, subCategories: [grandChild] });
const root = category({ id: 1, subCategories: [child] });
const internalRoot = category({ id: 4, type: CATEGORY_TYPES.internal });

const flushMacrotasks = () => new Promise((resolve) => setTimeout(resolve));

const buildDataTransfer = () => ({
  setData: vi.fn(),
  setDragImage: vi.fn(),
  effectAllowed: '',
  dropEffect: '',
});

const mountTree = ({
  draggable = true,
  draggedCategoryId = null,
  dropError = () => null,
}: {
  draggable?: boolean;
  draggedCategoryId?: string | null;
  dropError?: (params: { target: FormattedCategory; depth: number; position: CategoryDropPosition }) => string | null;
} = {}) =>
  mount(Accordion, {
    props: {
      categories: [root, internalRoot],
      expandedCategories: [root.id, child.id],
      maxLevel: 3,
      currentLevel: 1,
      activeCategoryId: null,
      showActions: true,
      draggable,
      draggedCategoryId,
      dropError,
    },
    global: { plugins: [i18n, createPinia()] },
  });

// Rows have no own selector; the grip/placeholder span is `[draggable]` and its parent is the row.
const rowOf = (wrapper: ReturnType<typeof mountTree>, handleIndex: number) =>
  new DOMWrapper(wrapper.findAll('[draggable]')[handleIndex]!.element.parentElement!);

describe('Accordion drag handles', () => {
  it('renders a draggable handle on every level of the tree', () => {
    const handles = mountTree().findAll('[draggable="true"]');

    expect(handles).toHaveLength(3);
    expect(handles.every((handle) => handle.find('svg.lucide-grip-vertical').exists())).toBe(true);
  });

  it('leaves the rows themselves undraggable so only the handle starts a drag', () => {
    const wrapper = mountTree();

    for (const handle of wrapper.findAll('[draggable="true"]')) {
      expect(handle.element.parentElement?.hasAttribute('draggable')).toBe(false);
    }
  });

  it('gives internal categories a non-draggable placeholder instead of a handle', () => {
    const wrapper = mountTree();

    const placeholders = wrapper.findAll('[draggable="false"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.find('svg').exists()).toBe(false);
  });

  it('renders no handles at all when drag mode is off', () => {
    expect(mountTree({ draggable: false }).findAll('[draggable]')).toHaveLength(0);
  });

  it('starts a drag from nested handles, not just the top-level one', async () => {
    const wrapper = mountTree();
    const handles = wrapper.findAll('[draggable="true"]');

    await handles[1]!.trigger('dragstart', { dataTransfer: buildDataTransfer() });
    await handles[2]!.trigger('dragstart', { dataTransfer: buildDataTransfer() });
    await flushMacrotasks();

    expect(wrapper.emitted('drag-start')?.map(([cat]) => (cat as FormattedCategory).id)).toEqual([
      child.id,
      grandChild.id,
    ]);
  });

  // A sync emit re-renders the page inside dragstart (the pending-moves bar appears above
  // the tree), and Chromium cancels a drag whose source reflows during the event, so the
  // emit must land in a later task.
  it('does not emit drag-start synchronously from the dragstart event', async () => {
    const wrapper = mountTree();
    const handle = wrapper.findAll('[draggable="true"]')[0]!;

    await handle.trigger('dragstart', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drag-start')).toBeUndefined();

    await flushMacrotasks();
    expect(wrapper.emitted('drag-start')?.map(([cat]) => (cat as FormattedCategory).id)).toEqual([root.id]);
  });

  it('highlights a valid target on dragover and emits drop', async () => {
    const wrapper = mountTree({ draggedCategoryId: child.id });
    const rootRow = rowOf(wrapper, 0);

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(rootRow.classes()).toContain('ring-primary');

    await rootRow.trigger('drop', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drop')).toEqual([[{ target: root, position: 'inside' }]]);
  });

  it('reorders instead of nesting when dropped on the top or bottom edge of a row', async () => {
    const wrapper = mountTree({ draggedCategoryId: child.id });
    const rootRow = rowOf(wrapper, 0);
    vi.spyOn(rootRow.element, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40 } as DOMRect);

    await rootRow.trigger('dragover', { clientY: 2, dataTransfer: buildDataTransfer() });
    expect(rootRow.classes()).toContain('before:bg-primary');
    expect(rootRow.classes()).not.toContain('ring-primary');

    await rootRow.trigger('drop', { clientY: 38, dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drop')).toEqual([[{ target: root, position: 'after' }]]);
  });

  it('dims a row only when neither nesting nor reordering next to it is allowed', () => {
    const wrapper = mountTree({
      draggedCategoryId: grandChild.id,
      dropError: ({ target, position }) => (target.id === root.id && position === 'inside' ? 'Too deep' : null),
    });

    expect(rowOf(wrapper, 0).classes()).not.toContain('opacity-40');
  });

  it('dims invalid targets while a drag is active, leaving valid ones crisp', () => {
    const wrapper = mountTree({
      draggedCategoryId: child.id,
      dropError: ({ target }) => (target.id === root.id ? 'Too deep' : null),
    });

    expect(rowOf(wrapper, 0).classes()).toContain('opacity-40');
    expect(rowOf(wrapper, 2).classes()).not.toContain('opacity-40');
  });

  it('reports the deny reason on dragover of an invalid target and refuses the drop', async () => {
    const wrapper = mountTree({
      draggedCategoryId: child.id,
      dropError: ({ target }) => (target.id === root.id ? 'Too deep' : null),
    });
    const rootRow = rowOf(wrapper, 0);

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drag-over-error')).toEqual([['Too deep']]);

    await rootRow.trigger('drop', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drop')).toBeUndefined();
    expect(wrapper.emitted('drag-over-error')).toEqual([['Too deep'], [null]]);
  });

  it('reports no message for the dragged row itself but still refuses the drop', async () => {
    const wrapper = mountTree({ draggedCategoryId: root.id, dropError: () => '' });
    const rootRow = rowOf(wrapper, 0);

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drag-over-error')).toEqual([[null]]);
    expect(rootRow.classes()).not.toContain('opacity-40');

    await rootRow.trigger('drop', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drop')).toBeUndefined();
  });

  it('emits drag-end and clears the highlight when the drag ends', async () => {
    const wrapper = mountTree({ draggedCategoryId: child.id });
    const rootRow = rowOf(wrapper, 0);

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(rootRow.classes()).toContain('ring-primary');

    await wrapper.findAll('[draggable="true"]')[0]!.trigger('dragend');
    expect(wrapper.emitted('drag-end')).toHaveLength(1);
    expect(rootRow.classes()).not.toContain('ring-primary');
  });

  it('keeps the highlight when dragleave only moves into a child of the same row', async () => {
    const wrapper = mountTree({ draggedCategoryId: child.id });
    const rootRow = rowOf(wrapper, 0);

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    await rootRow.trigger('dragleave', { relatedTarget: rootRow.element.firstElementChild });

    expect(rootRow.classes()).toContain('ring-primary');
  });

  it('clears the highlight and the reported error when the cursor leaves the row', async () => {
    const wrapper = mountTree({
      draggedCategoryId: grandChild.id,
      dropError: ({ target }) => (target.id === root.id ? 'Too deep' : null),
    });
    const rootRow = rowOf(wrapper, 0);
    const childRow = rowOf(wrapper, 1);

    await childRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(childRow.classes()).toContain('ring-primary');
    await childRow.trigger('dragleave', { relatedTarget: document.body });
    expect(childRow.classes()).not.toContain('ring-primary');

    await rootRow.trigger('dragover', { dataTransfer: buildDataTransfer() });
    expect(wrapper.emitted('drag-over-error')).toEqual([['Too deep']]);
    await rootRow.trigger('dragleave', { relatedTarget: document.body });
    expect(wrapper.emitted('drag-over-error')).toEqual([['Too deep'], [null]]);
  });

  it('reports each invalid target as the drag moves between them', async () => {
    const wrapper = mountTree({
      draggedCategoryId: grandChild.id,
      dropError: ({ target }) =>
        target.id === root.id ? 'Reason root' : target.id === child.id ? 'Reason child' : null,
    });

    await rowOf(wrapper, 0).trigger('dragover', { dataTransfer: buildDataTransfer() });
    await rowOf(wrapper, 1).trigger('dragover', { dataTransfer: buildDataTransfer() });

    expect(wrapper.emitted('drag-over-error')).toEqual([['Reason root'], ['Reason child']]);
  });

  it('ghosts the whole row rather than the handle', async () => {
    const wrapper = mountTree();
    const nestedHandle = wrapper.findAll('[draggable="true"]')[1]!;
    const dataTransfer = buildDataTransfer();

    await nestedHandle.trigger('dragstart', { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', child.id);
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(nestedHandle.element.parentElement, 0, expect.any(Number));
  });
});
