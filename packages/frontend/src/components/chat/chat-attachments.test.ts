import {
  CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE,
  CHAT_ATTACHMENTS_PER_MESSAGE,
  CHAT_ATTACHMENT_MAX_BYTES,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { CHAT_ATTACHMENT_ACCEPT, planChatAttachments } from './chat-attachments';

const BYTES_PER_MEGABYTE = 1024 * 1024;

const file = ({ name, type = '', size = 1024 }: { name: string; type?: string; size?: number }) => {
  const result = new File(['x'], name, { type });
  Object.defineProperty(result, 'size', { value: size });
  return result;
};

describe('planChatAttachments', () => {
  it('accepts images, PDFs, CSV and text files', () => {
    const incoming = [
      file({ name: 'receipt.jpg', type: 'image/jpeg' }),
      file({ name: 'scan.PNG', type: 'image/png' }),
      file({ name: 'photo.webp', type: 'image/webp' }),
      file({ name: 'statement.pdf', type: 'application/pdf' }),
      file({ name: 'export.csv', type: 'text/csv' }),
    ];

    const plan = planChatAttachments({ current: [], incoming });

    expect(plan.accepted).toEqual(incoming);
    expect(plan.problems).toEqual([]);
  });

  it('recognises a file by its extension when the browser gives no type', () => {
    const incoming = [file({ name: 'notes.txt' }), file({ name: 'export.csv' })];

    expect(planChatAttachments({ current: [], incoming }).accepted).toEqual(incoming);
  });

  it('refuses a file type the server cannot read', () => {
    const plan = planChatAttachments({
      current: [],
      incoming: [file({ name: 'archive.zip', type: 'application/zip' })],
    });

    expect(plan.accepted).toEqual([]);
    expect(plan.problems).toEqual([{ key: 'chat.composer.attachments.unsupported', params: { name: 'archive.zip' } }]);
  });

  it('refuses a file over the size limit and names the limit', () => {
    const big = file({ name: 'big.pdf', type: 'application/pdf', size: CHAT_ATTACHMENT_MAX_BYTES + 1 });

    const plan = planChatAttachments({ current: [], incoming: [big] });

    expect(plan.accepted).toEqual([]);
    expect(plan.problems).toEqual([
      {
        key: 'chat.composer.attachments.tooLarge',
        params: { name: 'big.pdf', max: CHAT_ATTACHMENT_MAX_BYTES / BYTES_PER_MEGABYTE },
      },
    ]);
  });

  it('stops at the number of files one message can carry, counting what is attached already', () => {
    const current = Array.from({ length: CHAT_ATTACHMENTS_PER_MESSAGE - 1 }, () => ({ sizeBytes: 10 }));
    const incoming = [file({ name: 'a.txt' }), file({ name: 'b.txt' })];

    const plan = planChatAttachments({ current, incoming });

    expect(plan.accepted).toEqual([incoming[0]]);
    expect(plan.problems).toEqual([
      { key: 'chat.composer.attachments.tooMany', params: { max: CHAT_ATTACHMENTS_PER_MESSAGE } },
    ]);
  });

  it('keeps the total size of a message under its limit', () => {
    const current = [{ sizeBytes: CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE - 100 }];

    const plan = planChatAttachments({ current, incoming: [file({ name: 'a.txt', size: 200 })] });

    expect(plan.accepted).toEqual([]);
    expect(plan.problems).toEqual([
      {
        key: 'chat.composer.attachments.totalTooLarge',
        params: { max: CHAT_ATTACHMENTS_MAX_BYTES_PER_MESSAGE / BYTES_PER_MEGABYTE },
      },
    ]);
  });

  it('reports a limit once however many files run into it', () => {
    const current = Array.from({ length: CHAT_ATTACHMENTS_PER_MESSAGE }, () => ({ sizeBytes: 10 }));
    const incoming = [file({ name: 'a.txt' }), file({ name: 'b.txt' }), file({ name: 'c.txt' })];

    expect(planChatAttachments({ current, incoming }).problems).toHaveLength(1);
  });

  it('offers the file picker the types it accepts', () => {
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('image/png');
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('.csv');
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('.heic');
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('image/heic');
  });
});
