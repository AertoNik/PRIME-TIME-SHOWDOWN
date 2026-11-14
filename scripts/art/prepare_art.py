#!/usr/bin/env python3
"""
Alpha 1.9.9 CARD EVOLUTION — the game's copies of the owner's card and arena-preview PNGs.

The originals stay untouched where the owner put them:
  PRIME_TIME_1_9_9_CARDS/<card id>.png            (33 cards, transparent background)
  PRIME_TIME_1_9_9_ARENA_PREVIEWS/<name>.png       (6 arena previews, transparent rounded corners)

The game gets lighter WebP copies (public/cards/{sm,md}, public/arenas/sm) with ONE geometry:

  * cards — every card is scaled uniformly so that its FRAME (the rounded card body, measured on the alpha channel)
    gets the same height FH and stands at the same place of the canvas: the canvas leaves room on the left and on
    the top for the energy gem that sticks out of the frame (as the old CSS .gem did). In CSS the card box is the
    frame and the picture overflows it by CARD_PAD (src/ui/cardArt.ts) — so rings, glows and overlays follow the frame.
  * arenas — trimmed to the picture (its own rounded corners stay), fitted into one 1.815 canvas, centred, never
    stretched or cropped.

Nothing is cropped from a picture (only empty transparent margins), nothing is stretched, the alpha stays.
Writes scripts/art/manifest.json (SHA-256 of every original and copy) for `npm run cardart`.

Needs Pillow + numpy (not project dependencies — a throwaway venv is enough):
  python3 -m venv /tmp/artenv && /tmp/artenv/bin/pip install pillow numpy
  /tmp/artenv/bin/python -I scripts/art/prepare_art.py
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CARDS_SRC = os.path.join(ROOT, 'PRIME_TIME_1_9_9_CARDS')
ARENAS_SRC = os.path.join(ROOT, 'PRIME_TIME_1_9_9_ARENA_PREVIEWS')
OUT = os.path.join(ROOT, 'public')

# the card box (= the frame) and the room around it, as fractions of the frame (keep equal to CARD_PAD in cardArt.ts)
FRAME_RATIO = 0.70  # width / height of the box
PAD = {'l': 0.055, 't': 0.085, 'r': 0.008, 'b': 0.008}
CARD_SIZES = {'sm': 240, 'md': 400}  # frame width in px

# the arena previews: file name -> arena id (src/config/arenas.config.ts)
ARENAS = {
    'original_prime_arena.png': 'original',
    'luxury_casino_set.png': 'casino',
    'prime_movie_backlot.png': 'backlot',
    'cursed_cemetery_set.png': 'graveyard',
    'new_year_studio_set.png': 'holiday',
    'neon_newsroom.png': 'newsroom',
}
ARENA_RATIO = 1.815
# every preview box of the game is ≤ 120 CSS px wide (prep 112, picker 112, league 92–110, poster 72): 480 px is sharp on 4× screens
ARENA_SIZES = {'sm': 480}

WEBP = dict(format='WEBP', quality=90, alpha_quality=100, method=6)
# the owner's PNGs carry a faint haze of alpha 1…4 (≤ 1.6 % opacity, invisible) over the whole canvas: it is dropped,
# so the picture's real edges can be measured and the transparent margins stay empty
HAZE = 4


def open_clean(src):
    im = Image.open(src).convert('RGBA')
    px = np.array(im)
    px[px[..., 3] <= HAZE] = 0
    return Image.fromarray(px, 'RGBA'), px[..., 3]


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def frame_of(alpha):
    """The card frame on the alpha channel: left/right on the middle row, top/bottom on a column right of the gem."""
    a = alpha > 128
    ys, xs = np.where(a)
    mid = (ys.min() + ys.max()) // 2
    row = np.where(a[mid])[0]
    left, right = int(row.min()), int(row.max()) + 1
    cx = int(left + (right - left) * 0.75)
    col = np.where(a[:, cx])[0]
    top, bottom = int(col.min()), int(col.max()) + 1
    return left, top, right, bottom


def card(src, card_id, manifest):
    im, alpha = open_clean(src)
    left, top, right, bottom = frame_of(alpha)
    fw, fh = right - left, bottom - top
    ys, xs = np.where(alpha > 0)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    entry = {'src': os.path.relpath(src, ROOT), 'sha256': sha(src), 'size': list(im.size), 'frame': [left, top, fw, fh], 'out': {}}
    for size, W in CARD_SIZES.items():
        H = round(W / FRAME_RATIO)
        cw, ch = round(W * (1 + PAD['l'] + PAD['r'])), round(H * (1 + PAD['t'] + PAD['b']))
        s = H / fh  # uniform: the frame height is the same on every card
        scaled = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
        # where the frame lands: its top at PAD.t*H, centred across the box
        fx = W * PAD['l'] + (W - fw * s) / 2
        fy = H * PAD['t']
        ox, oy = round(fx - left * s), round(fy - top * s)
        canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        # a negative offset only drops empty margins: crop them off the source, then composite at ≥ 0
        sx, sy = max(0, -ox), max(0, -oy)
        canvas.alpha_composite(scaled.crop((sx, sy, scaled.size[0], scaled.size[1])), (ox + sx, oy + sy))
        # nothing of the picture may fall off the canvas (only empty margins may)
        bx0, by0, bx1, by1 = (bbox[0] * s + ox, bbox[1] * s + oy, bbox[2] * s + ox, bbox[3] * s + oy)
        lost = max(0, -bx0) + max(0, -by0) + max(0, bx1 - cw) + max(0, by1 - ch)
        if lost > 1.5:
            sys.exit(f'{card_id} ({size}): {lost:.1f} px of the picture would fall off the canvas')
        rel = f'cards/{size}/{card_id}.webp'
        path = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        canvas.save(path, **WEBP)
        entry['out'][size] = {'file': rel, 'w': cw, 'h': ch, 'bytes': os.path.getsize(path), 'sha256': sha(path)}
    manifest['cards'][card_id] = entry


def arena(src, arena_id, manifest):
    im, alpha = open_clean(src)
    ys, xs = np.where(alpha > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    pic = im.crop(box)
    pw, ph = pic.size
    entry = {'src': os.path.relpath(src, ROOT), 'sha256': sha(src), 'size': list(im.size), 'picture': [pw, ph], 'out': {}}
    for size, W in ARENA_SIZES.items():
        H = round(W / ARENA_RATIO)
        s = min(W / pw, H / ph)  # contain: never cropped, never stretched
        nw, nh = round(pw * s), round(ph * s)
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(pic.resize((nw, nh), Image.LANCZOS), ((W - nw) // 2, (H - nh) // 2))
        rel = f'arenas/{size}/{arena_id}.webp'
        path = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        canvas.save(path, **WEBP)
        entry['out'][size] = {'file': rel, 'w': W, 'h': H, 'bytes': os.path.getsize(path), 'sha256': sha(path)}
    manifest['arenas'][arena_id] = entry


def main():
    manifest = {
        'note': 'Generated by scripts/art/prepare_art.py from the owner\'s originals; checked by `npm run cardart`.',
        'card': {'frameRatio': FRAME_RATIO, 'pad': PAD, 'sizes': CARD_SIZES},
        'arena': {'ratio': ARENA_RATIO, 'sizes': ARENA_SIZES},
        'cards': {},
        'arenas': {},
    }
    for f in sorted(os.listdir(CARDS_SRC)):
        if f.lower().endswith('.png'):
            card(os.path.join(CARDS_SRC, f), f[:-4], manifest)
    for f, arena_id in ARENAS.items():
        arena(os.path.join(ARENAS_SRC, f), arena_id, manifest)
    with open(os.path.join(ROOT, 'scripts', 'art', 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    total = sum(o['bytes'] for e in list(manifest['cards'].values()) + list(manifest['arenas'].values()) for o in e['out'].values())
    print(f"cards {len(manifest['cards'])}, arenas {len(manifest['arenas'])}, {total / 1024:.0f} KB of WebP")


if __name__ == '__main__':
    main()
