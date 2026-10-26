"""Generates the MoneyMatter logo SVGs and app/PWA icons from one geometric definition.

Run from anywhere: `python3 docs/brand/generate-logo.py`. macOS only: PNGs are
rendered with Quick Look (`qlmanage`) and post-processed with ImageMagick (`magick`).
`og-image.jpg` embeds the logo but is maintained by hand.
"""

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'docs' / 'brand'
FRONTEND = ROOT / 'packages' / 'frontend' / 'public'
LANDING = ROOT / 'packages' / 'landing' / 'public'
DOCS = ROOT / 'packages' / 'docs'

VIOLET = '#8b5cf6'
TILE_RX = 192
OUTER_RADIUS = 22
INNER_RADIUS = 6
MASKABLE_SCALE = 0.85

GRADIENT = (
    '<defs><linearGradient id="mm-bg" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#8b5cf6"/><stop offset=".5" stop-color="#a855f7"/>'
    '<stop offset="1" stop-color="#9333ea"/></linearGradient></defs>'
)


def shapes(*, bar=136, gap=72, diag_gap=62, slope=0.54, top=212, bottom=812):
    cx = 512
    left_x = cx - (3 * bar + 2 * gap) / 2
    right_x = 1024 - left_x
    sec = math.sqrt(1 + slope ** 2)
    v, gv = bar * sec, diag_gap * sec

    def chevron_bottom(x):
        return top + v + slope * ((x - left_x) if x <= cx else (right_x - x))

    ml, mr, ri = cx - bar / 2, cx + bar / 2, right_x - bar
    chevron = [
        (left_x, top), (cx, top + slope * (cx - left_x)), (right_x, top), (right_x, bottom),
        (ri, bottom), (ri, chevron_bottom(ri)), (cx, chevron_bottom(cx)), (left_x, top + v),
    ]
    left_leg = [(left_x, top + v + gv), (left_x + bar, chevron_bottom(left_x + bar) + gv), (left_x + bar, bottom), (left_x, bottom)]
    middle_leg = [(ml, chevron_bottom(ml) + gv), (cx, chevron_bottom(cx) + gv), (mr, chevron_bottom(mr) + gv), (mr, bottom), (ml, bottom)]
    return chevron, left_leg, middle_leg


def rounded_path(*, points, radii):
    n, out = len(points), []
    for i, (px, py) in enumerate(points):
        ax, ay = points[i - 1]
        bx, by = points[(i + 1) % n]
        cmd = 'M' if not out else 'L'
        r = radii[i]
        if r <= 0:
            out.append(f'{cmd}{px:.1f} {py:.1f}')
            continue
        l1, l2 = math.hypot(ax - px, ay - py), math.hypot(bx - px, by - py)
        u1 = ((ax - px) / l1, (ay - py) / l1)
        u2 = ((bx - px) / l2, (by - py) / l2)
        theta = math.acos(max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1])))
        t = r / math.tan(theta / 2)
        sweep = 1 if (px - ax) * (by - py) - (py - ay) * (bx - px) > 0 else 0
        out.append(
            f'{cmd}{px + u1[0] * t:.1f} {py + u1[1] * t:.1f}'
            f'A{r} {r} 0 0 {sweep} {px + u2[0] * t:.1f} {py + u2[1] * t:.1f}'
        )
    return ''.join(out) + 'Z'


def mark_path():
    chevron, left_leg, middle_leg = shapes()
    # Inner details (chevron V tip, middle column top) get a tighter radius so the small "m" stays crisp.
    chevron_r = [OUTER_RADIUS] * 8
    chevron_r[5], chevron_r[6] = 0, INNER_RADIUS
    middle_r = [INNER_RADIUS, 0, INNER_RADIUS, OUTER_RADIUS, OUTER_RADIUS]
    return ''.join(
        rounded_path(points=p, radii=r)
        for p, r in ((chevron, chevron_r), (left_leg, [OUTER_RADIUS] * 4), (middle_leg, middle_r))
    )


def svg(*, tile_rx=None, mark_fill='white', scale=1.0):
    background = '' if tile_rx is None else f'{GRADIENT}<rect width="1024" height="1024" rx="{tile_rx}" fill="url(#mm-bg)"/>'
    transform = '' if scale == 1 else f' transform="translate(512 512) scale({scale}) translate(-512 -512)"'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        f'{background}<path fill="{mark_fill}"{transform} d="{mark_path()}"/></svg>\n'
    )


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def render(*, svg_text, out_dir, name):
    src = Path(out_dir) / f'{name}.svg'
    src.write_text(svg_text)
    run('qlmanage', '-t', '-s', '1024', '-o', str(out_dir), str(src))
    out = Path(out_dir) / f'{name}.svg.png'
    # qlmanage exits 0 even when it renders nothing (e.g. no GUI session).
    if not out.is_file():
        raise SystemExit(f'qlmanage produced no PNG for {src.name}')
    return out


def resize(*, src, dest, size, rounded=False, opaque=False):
    args = ['magick', str(src)]
    if rounded:
        args += ['(', '-size', '1024x1024', 'xc:none', '-fill', 'white', '-draw',
                 f'roundrectangle 0,0,1023,1023,{TILE_RX},{TILE_RX}', ')',
                 '-alpha', 'set', '-compose', 'DstIn', '-composite']
    args += ['-filter', 'Lanczos', '-resize', f'{size}x{size}', '-strip']
    if opaque:
        args += ['-alpha', 'remove', '-alpha', 'off']
    run(*args, str(dest))


def main():
    logo = svg(tile_rx=TILE_RX)
    svgs = {
        BRAND / 'logo.svg': logo,
        BRAND / 'app-icon.svg': svg(tile_rx=0),
        BRAND / 'logo-mark.svg': svg(),
        BRAND / 'logo-mark-violet.svg': svg(mark_fill=VIOLET),
        LANDING / 'img' / 'logo.svg': logo,
        FRONTEND / 'img' / 'logo.svg': logo,
        FRONTEND / 'favicon.svg': logo,
        DOCS / 'src' / 'assets' / 'logo.svg': logo,
        DOCS / 'public' / 'favicon.svg': logo,
    }
    for path, text in svgs.items():
        path.write_text(text)

    with tempfile.TemporaryDirectory() as tmp:
        full = render(svg_text=svg(tile_rx=0), out_dir=tmp, name='full')
        maskable = render(svg_text=svg(tile_rx=0, scale=MASKABLE_SCALE), out_dir=tmp, name='maskable')

        resize(src=full, dest=BRAND / 'app-icon-1024.png', size=1024, opaque=True)
        resize(src=full, dest=FRONTEND / 'apple-touch-icon.png', size=180, opaque=True)
        resize(src=full, dest=FRONTEND / 'favicon-96x96.png', size=96, rounded=True)
        for size in (192, 512):
            resize(src=full, dest=FRONTEND / f'web-app-manifest-{size}x{size}.png', size=size, rounded=True)
            resize(src=maskable, dest=FRONTEND / f'web-app-manifest-maskable-{size}x{size}.png', size=size, opaque=True)

        ico_parts = []
        for size in (16, 32, 48):
            part = Path(tmp) / f'ico-{size}.png'
            resize(src=full, dest=part, size=size, rounded=True)
            ico_parts.append(str(part))
        run('magick', *ico_parts, str(FRONTEND / 'favicon.ico'))

    print('Generated', len(svgs), 'SVGs and PNG icons')


if __name__ == '__main__':
    if not shutil.which('qlmanage') or not shutil.which('magick'):
        raise SystemExit('Requires macOS qlmanage and ImageMagick (magick)')
    main()
