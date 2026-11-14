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


# ------------------------------------------------------------------ Beta 2.0 VISUAL EVOLUTION
# The owner's emblem / icon PNGs (originals untouched where the owner put them):
#   PRIME_TIME_2_0_RANK_ART/        43 PNG — league ranks, league symbols, producer levels, career stages, fighter fame
#   PRIME_TIME_2_0_EFFECT_PREVIEWS/ 15 PNG — game-mode emblems, currencies, effect previews
# Both folders are FLAT. What Finder shows as «league/08_legend.png» is the POSIX name «league:08_legend.png» (Finder
# displays a «:» of a file name as «/»), and two names begin with a space (« league_ui:04_contender_generic.png»,
# « glitch_dash.png»). So every original is found by its name with the spaces trimmed (exactly one match), and the
# manifest keeps the real on-disk name.
#
# One geometry for every icon: the picture (alpha > HAZE) is trimmed of its empty margins and fitted — never stretched,
# never cropped — into a SQUARE canvas with the same small margin, centred. So 1024² and 1254² renders, tall badges and
# wide trails all stand at one scale and one place in the UI.
#
# League ranks get two variants:
#   full   — the owner's emblem with its division bars (the 21 divided steps; LEGEND has none): the player's exact step;
#   plain  — the same emblem without the bars, cut on the empty gap above them: a rank WITHOUT a division (season
#            history, the leaderboard's tiny icon next to the «… III» text) — never extra bars drawn over a picture.
RANK_ART_SRC = os.path.join(ROOT, 'PRIME_TIME_2_0_RANK_ART')
FX_ART_SRC = os.path.join(ROOT, 'PRIME_TIME_2_0_EFFECT_PREVIEWS')
ICON_MARGIN = 0.03  # of the canvas side, on every side
RANKS = ['casting', 'first_take', 'night_air', 'contender', 'headliner', 'star', 'icon', 'legend']  # = RANKS in league.config.ts
DIVS = ['iii', 'ii', 'i']
# group -> canvas sides of its variants (px). Rank emblems are shown from 18 to 132 CSS px (sm ≤ 64, md above, at 3×).
ICON_SIZES = {
    'ranks': {'xs': 96, 'sm': 192, 'md': 400},
    'ranks-plain': {'xs': 96, 'sm': 192},
    'league': {'sm': 192, 'md': 400},
    'levels': {'sm': 192},
    'stages': {'sm': 192, 'md': 400},
    'fame': {'xs': 96, 'sm': 192},
    'modes': {'sm': 192, 'md': 400},
    'currency': {'xs': 96, 'sm': 192},
    'effects': {'sm': 256, 'md': 512},
    # Beta 2.0 final: the existing achievements, the collection's reward sections, two seasonal goals
    'achievements': {'sm': 192, 'md': 400},
    'rewards': {'xs': 96, 'sm': 192},
    'goals': {'xs': 96, 'sm': 192},
}


def icon_specs():
    """[(group, id, folder, wanted file name)] — every one of the 79 originals, spelled out by its real game id."""
    s = []
    for n, r in enumerate(RANKS, 1):
        for d in (DIVS if r != 'legend' else ['']):
            s.append(('ranks', f'{r}_{d}' if d else r, RANK_ART_SRC, f'league:{n:02d}_{r}{"_" + d if d else ""}.png'))
    # the plain (bar-less) emblem of each rank, cut from its division III picture (always the full 1254² render)
    for n, r in enumerate(RANKS, 1):
        s.append(('ranks-plain', r, RANK_ART_SRC, f'league:{n:02d}_{r}{"_iii" if r != "legend" else ""}.png'))
    # the league's own symbols (no player's rank in them): CONTENDER for «the league», ICON for «the season emblem»
    s.append(('league', 'symbol', RANK_ART_SRC, 'league_ui:04_contender_generic.png'))
    s.append(('league', 'season', RANK_ART_SRC, 'league_ui:07_icon_generic.png'))
    for lv in range(1, 11):
        s.append(('levels', f'{lv:02d}', RANK_ART_SRC, f'career_levels:level_{lv:02d}.png'))
    for lv in range(11, 21):  # Beta 2.0 final: the owner's badges of the extended career (LEVEL_THRESHOLDS 11–20)
        s.append(('levels', f'{lv:02d}', FX_ART_SRC, f'level_{lv:02d}.png'))
    for n, st in enumerate(['rookie', 'rising', 'star', 'legendary'], 1):  # = CAREER_STAGES ids in career.ts
        s.append(('stages', st, RANK_ART_SRC, f'career_stages:stage_{n}_{st}.png'))
    for n in range(1, 6):  # = FAME_TIERS in career.ts, lowest first
        s.append(('fame', str(n), RANK_ART_SRC, f'fighter_fame:fame_{n:02d}.png'))
    s.append(('modes', 'career', FX_ART_SRC, 'career_mode_emblem.png'))
    s.append(('modes', 'league', FX_ART_SRC, 'league_mode_emblem.png'))
    s.append(('currency', 'money', FX_ART_SRC, 'career_dollars.png'))  # career dollars ($)
    s.append(('currency', 'rep', FX_ART_SRC, 'show_stars.png'))  # reputation (★)
    s.append(('currency', 'tokens', FX_ART_SRC, 'prime_tokens.png'))  # PRIME TOKENS (league only, never roubles)
    # effect previews -> the real cosmetic ids (cosmetics.config.ts)
    for f, cid in [
        ('phantom_dash.png', 'dash_prime_phantom'),  # PHANTOM DASH (PRIME SHOP); the Halloween PURPLE PHANTOM keeps its art
        ('glitch_dash.png', 'dash_glitch'),
        ('comet_trail.png', 'dash_comet'),
        ('arc_surge.png', 'dash_league_arc'),
        ('candy_comet.png', 'dash_candy_comet'),
        ('golden_confetti.png', 'victory_golden_confetti'),
        ('studio_spotlights.png', 'victory_studio_spotlights'),
        ('neon_fireworks.png', 'victory_neon_fireworks'),
        ('pumpkin_victory.png', 'victory_pumpkin'),
        ('midnight_confetti.png', 'victory_midnight_confetti'),
    ]:
        s.append(('effects', cid, FX_ART_SRC, f))
    # Beta 2.0 final — pictures of EXISTING things only (Collection.achievements(), the collection's reward sections,
    # events.config.ts goals); nothing new is earned through them
    for f, aid in [
        ('achievement_boss_legend_victory.png', 'boss'),  # boss-<id> «Победитель легенды»
        ('achievement_survival_final_star.png', 'survival'),  # survival-clear «Последняя звезда эфира»
        ('achievement_challenge_energy_rush.png', 'energy_rush'),  # challenge-energy_rush (CHALLENGES ids)
        ('achievement_challenge_high_stakes.png', 'high_stakes'),
        ('achievement_challenge_prime_spotlight.png', 'spotlight'),
    ]:
        s.append(('achievements', aid, FX_ART_SRC, f))
    for f, rid in [
        ('collection_rewards_emblem.png', 'collection'),  # MY COLLECTION «Награды»
        ('reward_career_emblem.png', 'career'),  # its three sources = CosmeticDef.source career / boss / daily
        ('reward_boss_fight_emblem.png', 'boss'),
        ('reward_daily_streak_emblem.png', 'daily'),
    ]:
        s.append(('rewards', rid, FX_ART_SRC, f))
    s.append(('goals', 'debut', FX_ART_SRC, 'season_goal_debut_in_broadcast.png'))  # «Дебют в эфире»
    s.append(('goals', 'combo', FX_ART_SRC, 'season_goal_combo_master.png'))  # «Мастер комбо»
    return s


def find_src(folder, wanted):
    """The one file of `folder` whose name, spaces trimmed, is `wanted` (exits on none or several)."""
    hits = [f for f in os.listdir(folder) if f.strip() == wanted]
    if len(hits) != 1:
        sys.exit(f'{os.path.basename(folder)}/{wanted}: {len(hits)} matching files')
    return hits[0]


def cut_bars(im, alpha):
    """The emblem without its division bars: cut in the middle of the last empty gap above the bottom block."""
    rows = (alpha > 60).any(axis=1)
    ys = np.where(rows)[0]
    top, bottom = int(ys.min()), int(ys.max())
    h = bottom - top + 1
    y = bottom
    while y > top and rows[y]:  # the bars
        y -= 1
    gap_end = y
    while y > top and not rows[y]:  # the empty gap above them
        y -= 1
    gap_start = y + 1
    bars, gap = bottom - gap_end, gap_end - gap_start + 1
    # the bars are a short block at the very bottom; the gap above them is at least 2 px (ИКОНА PRIME: 3–5 px)
    if not (0.02 * h <= bars <= 0.14 * h and gap >= 2 and gap_start > top + 0.75 * h):
        sys.exit(f'division bars not found (bars {bars} px, gap {gap} px of {h})')
    cut = (gap_start + gap_end) // 2
    px = np.array(im)
    px[cut:, :, :] = 0
    return Image.fromarray(px, 'RGBA'), cut


def fit_square(im, alpha, side):
    ys, xs = np.where(alpha > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    pic = im.crop(box)
    inner = side * (1 - 2 * ICON_MARGIN)
    s = inner / max(pic.size)
    nw, nh = max(1, round(pic.size[0] * s)), max(1, round(pic.size[1] * s))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(pic.resize((nw, nh), Image.LANCZOS), ((side - nw) // 2, (side - nh) // 2))
    return canvas, box


def icon(group, icon_id, folder, wanted, manifest):
    name = find_src(folder, wanted)
    src = os.path.join(folder, name)
    im, alpha = open_clean(src)
    entry = {'src': os.path.relpath(src, ROOT), 'sha256': sha(src), 'size': list(im.size), 'out': {}}
    if group == 'ranks-plain' and icon_id != 'legend':
        im, cut = cut_bars(im, alpha)
        alpha = np.array(im)[..., 3]
        entry['cutAt'] = cut
    for size, side in ICON_SIZES[group].items():
        canvas, box = fit_square(im, alpha, side)
        entry['bbox'] = list(box)
        rel = f'ui/{group}/{size}/{icon_id}.webp'
        path = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        canvas.save(path, **WEBP)
        entry['out'][size] = {'file': rel, 'w': side, 'h': side, 'bytes': os.path.getsize(path), 'sha256': sha(path)}
    manifest['icons'].setdefault(group, {})[icon_id] = entry


def icons(manifest):
    manifest['icon'] = {'margin': ICON_MARGIN, 'sizes': ICON_SIZES}
    manifest['icons'] = {}
    specs = icon_specs()
    for spec in specs:
        icon(*spec, manifest)
    used = {(folder, find_src(folder, wanted)) for _, _, folder, wanted in specs}
    for folder in (RANK_ART_SRC, FX_ART_SRC):
        for f in os.listdir(folder):
            if f.lower().endswith('.png') and (folder, f) not in used:
                sys.exit(f'{os.path.basename(folder)}/{f!r} is not mapped to a game id')


def main():
    path = os.path.join(ROOT, 'scripts', 'art', 'manifest.json')
    if '--icons-only' in sys.argv:
        # Beta 2.0: (re)build only the icons; the 1.9.9 card and arena copies and their manifest stay byte for byte
        with open(path, encoding='utf-8') as fh:
            manifest = json.load(fh)
    else:
        manifest = {
            'note': 'Generated by scripts/art/prepare_art.py from the owner\'s originals; checked by `npm run cardart` and `npm run art20`.',
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
    icons(manifest)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    total = sum(o['bytes'] for e in list(manifest['cards'].values()) + list(manifest['arenas'].values()) for o in e['out'].values())
    itotal = sum(o['bytes'] for g in manifest['icons'].values() for e in g.values() for o in e['out'].values())
    count = sum(len(g) for g in manifest['icons'].values())
    print(f"cards {len(manifest['cards'])}, arenas {len(manifest['arenas'])}, {total / 1024:.0f} KB of WebP; icons {count} ({itotal / 1024:.0f} KB)")


if __name__ == '__main__':
    main()
