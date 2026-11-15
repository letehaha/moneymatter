import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Everything the model or a document wrote reaches the screen through text nodes. These sources must
 * never turn a string into markup, a link or an image, which would open an exfiltration channel.
 */
const ROOTS = [
  'src/components/chat',
  'src/pages/chat',
  'src/composable/chat',
  'src/pages/settings/subpages/ai/pages/chat-applied-changes.vue',
];

const FORBIDDEN = [
  { name: 'v-html', pattern: /v-html/ },
  { name: 'innerHTML', pattern: /\.innerHTML|\binnerHTML\s*=/ },
  { name: 'insertAdjacentHTML', pattern: /insertAdjacentHTML/ },
  { name: 'a raw html render prop', pattern: /domProps\s*:\s*\{[^}]*innerHTML/ },
];

const isSource = ({ file }: { file: string }) => /\.(vue|ts)$/.test(file) && !/\.(test|spec)\.ts$/.test(file);

function collect({ target }: { target: string }): string[] {
  const absolute = path.resolve(process.cwd(), target);
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolute, entry.name);
    return entry.isDirectory() ? collect({ target: child }) : [child];
  });
}

/** Comments may name the thing they forbid. */
const withoutComments = ({ source }: { source: string }) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('chat sources render no raw html', () => {
  const files = ROOTS.flatMap((target) => collect({ target })).filter((file) => isSource({ file }));

  it('finds the chat sources', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)('never uses $name', ({ pattern }) => {
    const offenders = files
      .filter((file) => pattern.test(withoutComments({ source: fs.readFileSync(file, 'utf8') })))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
