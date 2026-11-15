import { loadChatAttachmentImage } from '@/api/chat';
import type { ChatAttachmentPart } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { createChatI18n } from '../cards/card-test-fixtures';
import UserAttachment from './user-attachment.vue';

vi.mock('@/api/chat', () => ({ loadChatAttachmentImage: vi.fn() }));

/** A dialog that renders its content only while open. */
const DialogStub = defineComponent({
  props: { open: Boolean },
  setup:
    (props, { slots }) =>
    () =>
      props.open ? h('div', { 'data-testid': 'enlarged' }, [slots.title?.(), slots.default?.()]) : null,
});

const part = (overrides: Partial<ChatAttachmentPart> = {}): ChatAttachmentPart => ({
  type: 'attachment',
  id: 'p1',
  attachmentId: 'att-1',
  ...overrides,
});

const mountAttachment = ({ value }: { value: ChatAttachmentPart }) =>
  mount(UserAttachment, {
    props: { part: value },
    global: { plugins: [createChatI18n()], stubs: { ResponsiveDialog: DialogStub } },
  });

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

describe('UserAttachment', () => {
  beforeEach(() => {
    vi.mocked(loadChatAttachmentImage).mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an image as a thumbnail loaded from the attachment image endpoint', async () => {
    vi.mocked(loadChatAttachmentImage).mockResolvedValue(PNG);

    const wrapper = mountAttachment({ value: part({ fileName: 'receipt.png', mimeType: 'image/png', kind: 'image' }) });
    await flushPromises();

    expect(loadChatAttachmentImage).toHaveBeenCalledWith({ attachmentId: 'att-1' });
    const image = wrapper.find('[data-testid="attachment-thumbnail"] img');
    expect(image.attributes('src')).toBe('blob:thumb');
    expect(image.attributes('alt')).toBe('receipt.png');
  });

  it('enlarges the image on a click', async () => {
    vi.mocked(loadChatAttachmentImage).mockResolvedValue(PNG);
    const wrapper = mountAttachment({ value: part({ fileName: 'receipt.png', mimeType: 'image/png', kind: 'image' }) });
    await flushPromises();
    expect(wrapper.find('[data-testid="enlarged"]').exists()).toBe(false);

    await wrapper.find('[data-testid="attachment-thumbnail"]').trigger('click');

    const enlarged = wrapper.find('[data-testid="enlarged"]');
    expect(enlarged.exists()).toBe(true);
    expect(enlarged.find('img').attributes('src')).toBe('blob:thumb');
  });

  it.each([
    ['a PDF', { fileName: 'statement.pdf', mimeType: 'application/pdf', kind: 'pdf' as const }],
    ['a CSV', { fileName: 'october.csv', mimeType: 'text/csv', kind: 'csv' as const }],
  ])('shows %s as a chip with its name and loads nothing', async (_name, metadata) => {
    const wrapper = mountAttachment({ value: part(metadata) });
    await flushPromises();

    expect(loadChatAttachmentImage).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="attachment-chip"]').text()).toContain(metadata.fileName);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('shows a message sent before attachments carried their kind as a thumbnail when it is an image', async () => {
    vi.mocked(loadChatAttachmentImage).mockResolvedValue(PNG);

    const wrapper = mountAttachment({ value: part() });
    await flushPromises();

    expect(wrapper.find('[data-testid="attachment-thumbnail"] img').exists()).toBe(true);
  });

  it('falls back to a plain chip when an attachment of unknown kind is not an image or cannot be read', async () => {
    vi.mocked(loadChatAttachmentImage).mockRejectedValue(new Error('not an image'));

    const wrapper = mountAttachment({ value: part() });
    await flushPromises();

    expect(wrapper.find('[data-testid="attachment-chip"]').text()).toContain('Attachment');
  });

  it('shows the chip with its name when the image of a known image cannot be read', async () => {
    vi.mocked(loadChatAttachmentImage).mockRejectedValue(new Error('gone'));

    const wrapper = mountAttachment({ value: part({ fileName: 'receipt.png', mimeType: 'image/png', kind: 'image' }) });
    await flushPromises();

    expect(wrapper.find('[data-testid="attachment-chip"]').text()).toContain('receipt.png');
  });

  it('releases the image URL when it goes away', async () => {
    vi.mocked(loadChatAttachmentImage).mockResolvedValue(PNG);
    const wrapper = mountAttachment({ value: part({ fileName: 'receipt.png', mimeType: 'image/png', kind: 'image' }) });
    await flushPromises();

    wrapper.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb');
  });
});
