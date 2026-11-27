import { existsSync } from 'node:fs';

type ScreenshotVariant = { src: string; theme?: 'shot-light' | 'shot-dark' };

export const screenshotVariants = ({ base }: { base: string }): ScreenshotVariant[] => {
  if (!existsSync(`public${base}@1x.webp`)) throw new Error(`Missing screenshot: ${base}`);
  return existsSync(`public${base}-light@1x.webp`)
    ? [
        { src: `${base}-light`, theme: 'shot-light' },
        { src: base, theme: 'shot-dark' },
      ]
    : [{ src: base }];
};

const SCREENSHOT_IMG = /<img src="(\/img\/landing\/screenshots\/[^"]+)@2x\.webp" alt="([^"]*)">/g;

/** Markdown screenshots point at the dark `@2x` file; this swaps in the same light/dark pair `screenshot.astro` renders. */
export const withThemedScreenshots = ({ html }: { html: string }) => {
  const result = html.replace(SCREENSHOT_IMG, (_, base: string, alt: string) =>
    screenshotVariants({ base })
      .map(
        ({ src, theme }) =>
          `<picture class="shot${theme ? ` ${theme}` : ''}"><img src="${src}@1x.webp" srcset="${src}@1x.webp 1x, ${src}@2x.webp 2x" alt="${alt}" loading="lazy" decoding="async"></picture>`,
      )
      .join(''),
  );
  const leftover = /<img src="\/img\/landing\/screenshots\/[^"]+@2x\.webp"[^>]*>/.exec(result);
  if (leftover) throw new Error(`Unhandled guide screenshot markup: ${leftover[0]}`);
  return result;
};
