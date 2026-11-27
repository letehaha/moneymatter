import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';

// Builds one small light|dark sheet per screenshot so a review reads a single image per pair.
// Args: screenshot srcs (`/screenshots/settings/household.png`), or `--since <minutes>` (default 120) for recently written files.
const PUBLIC = new URL('../public', import.meta.url).pathname;
const SHOTS = join(PUBLIC, 'screenshots');
const OUT = new URL('./capture/.check/', import.meta.url).pathname;
const HALF = { width: 760, height: 1400 };
const GAP = 24;

const args = process.argv.slice(2);
const sinceIndex = args.indexOf('--since');
const sinceMinutes = sinceIndex === -1 ? 120 : Number(args[sinceIndex + 1]);
const explicit = sinceIndex === -1 ? args : args.toSpliced(sinceIndex, 2);
if (!Number.isFinite(sinceMinutes)) {
  console.error('--since needs a number of minutes');
  process.exit(1);
}

const lightPath = (path) => path.replace(/\.dark\.png$/, '.png');
const darkPath = (path) => path.replace(/(?<!\.dark)\.png$/, '.dark.png');

const paths = explicit.length
  ? explicit.map((src) => join(PUBLIC, src.replace(/^\/?(public\/)?/, '')))
  : readdirSync(SHOTS, { recursive: true })
      .filter((file) => file.endsWith('.png'))
      .map((file) => join(SHOTS, file))
      .filter((path) => Date.now() - statSync(path).mtimeMs < sinceMinutes * 60_000);
const lights = [...new Set(paths.map(lightPath))];

// Not wiped between runs: parallel capture agents read their own sheets from here.
mkdirSync(OUT, { recursive: true });

for (const light of lights) {
  const name = relative(SHOTS, light);
  const halves = [light, darkPath(light)].filter((path) => existsSync(path));
  if (!halves.length) {
    console.log(`${name}  ⚠ not found`);
    process.exitCode = 1;
    continue;
  }
  const notes = [];
  if (halves.length < 2) notes.push(`missing ${existsSync(light) ? 'dark' : 'light'}`);

  const sizes = await Promise.all(halves.map((path) => sharp(path).metadata()));
  if (sizes.length === 2 && (sizes[0].width !== sizes[1].width || sizes[0].height !== sizes[1].height))
    notes.push(`light ${sizes[0].width}x${sizes[0].height} vs dark ${sizes[1].width}x${sizes[1].height}`);

  const scaled = await Promise.all(
    halves.map((path) =>
      sharp(path)
        .resize({ ...HALF, fit: 'inside', withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const width = scaled.reduce((sum, { info }) => sum + info.width, 0) + GAP * (scaled.length + 1);
  const height = Math.max(...scaled.map(({ info }) => info.height)) + GAP * 2;
  let left = GAP;
  const layers = scaled.map(({ data, info }) => {
    const layer = { input: data, left, top: GAP };
    left += info.width + GAP;
    return layer;
  });

  const out = join(OUT, name.replaceAll('/', '__'));
  await sharp({ create: { width, height, channels: 3, background: '#808080' } })
    .composite(layers)
    .png()
    .toFile(out);
  if (notes.length) process.exitCode = 1;
  console.log(`${out}${notes.length ? `  ⚠ ${notes.join('; ')}` : ''}`);
}

if (!lights.length)
  console.log(`No screenshots ${explicit.length ? 'given' : `written in the last ${sinceMinutes} min`}.`);
