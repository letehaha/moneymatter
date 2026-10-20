import { CHAT_THREAD_TITLE_MAX_CHARS } from '@bt/shared/types';

const ELLIPSIS = '…';

/**
 * File names a phone or a screenshot tool gives an image: they name nothing, so a thread whose message is
 * only such a file stays untitled, for the model to name, ("image", "Screenshot 2026-10-19 at 11.02", "IMG_4821").
 */
const GENERIC_IMAGE_NAME =
  /^(?:pasted[ _-]?)?(?:image|img|photo|picture|pic|screenshot|screen[ _-]?shot|clipboard)?[ _-]*[\d .:_-]*(?:at[ \d.:_-]*)?$/i;

const isGenericImageName = ({ stem, fileName }: { stem: string; fileName: string }) =>
  /\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(fileName) && GENERIC_IMAGE_NAME.test(stem);

/**
 * The title a thread gets from its first message: the text with its whitespace collapsed, or the
 * name of the first attachment when the message is only a file. A long text is cut by characters,
 * not code units, so an emoji is never split. An empty title means there was nothing to name it from.
 */
export const deriveThreadTitle = ({ text, attachmentNames }: { text: string; attachmentNames: string[] }): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const fileName = attachmentNames[0] ?? '';
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const source = collapsed || (isGenericImageName({ stem, fileName }) ? '' : stem);

  const characters = [...source];
  if (characters.length <= CHAT_THREAD_TITLE_MAX_CHARS) return source;

  return characters.slice(0, CHAT_THREAD_TITLE_MAX_CHARS - 1).join('') + ELLIPSIS;
};

const CONTROL_CHARACTERS = /\p{Cc}/gu;
/** Characters that mean something in Markdown or HTML; a title is plain text, so none of them is kept. */
const MARKUP_CHARACTERS = /[*_`#>~|\\<>[\]]/g;
const WRAPPING_QUOTES = /^["'«»“”„‘’`]+|["'«»“”„‘’`]+$/g;

/**
 * The title the model gave a thread, as text a person can trust: control characters and markup removed,
 * whitespace collapsed, wrapping quotes dropped, cut at the title limit. `null` when nothing is left.
 */
export const sanitizeModelThreadTitle = ({ title }: { title: string }): string | null => {
  const clean = title
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(MARKUP_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(WRAPPING_QUOTES, '')
    .trim();
  if (!clean) return null;

  const characters = [...clean];
  return characters.length <= CHAT_THREAD_TITLE_MAX_CHARS
    ? clean
    : characters.slice(0, CHAT_THREAD_TITLE_MAX_CHARS - 1).join('') + ELLIPSIS;
};
