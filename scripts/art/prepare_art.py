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
import unicodedata

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
    # Beta 2.2: MY COLLECTION's section emblems (44–46 CSS px; md for bigger headers), titles (league road 38 px, the
    # collection's tiles 132 px → md)
    'sections': {'sm': 192, 'md': 400},
    'titles': {'xs': 96, 'sm': 192, 'md': 400},
    # Beta 2.2 final: WINTER SHOWDOWN's quests (40 CSS px) and the season's gift (menu 30 px, the DAILY window 58–96 px)
    'winter': {'xs': 96, 'sm': 192, 'md': 400},
    # Beta 2.3: the main screen's own icons (the DAILY gift, «Пригласить друга», PRIME SHOP, CARDS, the settings button)
    'ui': {'xs': 96, 'sm': 192},
}

# Beta 2.3 — the bottom bar's button skins (БОЙЦЫ / КАРЬЕРА / КОЛЛЕКЦИЯ): wide pictures (≈3.7 : 1) with the emblem on the
# left and an empty panel for the label, which stays HTML text. Not squared: trimmed to the picture, the aspect kept,
# made at these HEIGHTS (px). `l` / `r`: the share of the width that is the emblem (left) and the rounded end (right) —
# the game draws them unscaled and stretches only the panel between (CSS border-image), so no width distorts the emblem.
NAV_HEIGHTS = {'sm': 160, 'md': 240}
NAV_SKINS = {
    'fighters': ('ui_nav_fighters_button_v3.png', 0.46, 0.14),
    'career': ('ui_nav_career_button_v3.png', 0.5, 0.16),
    'collection': ('ui_nav_collection_button_v3.png', 0.36, 0.14),
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


# ------------------------------------------------------------------ Beta 2.2 REWARDS & ART INTEGRATION
# PRIME_TIME_2_2_ART_ASSETS/ — 17 PNG of the owner (1254² RGBA). Each is mapped to an EXISTING game id (docs/
# BETA_2_2_DEVELOPMENT_REPORT.md §1 has the table and the reasons); nothing new is earned through a picture. The mode
# icons «Карьера» / «PRIME LEAGUE» stay as they are. `--icons-22` adds exactly these entries and files: every earlier
# entry of the manifest and every earlier WebP stays byte for byte.
ART22_SRC = os.path.join(ROOT, 'PRIME_TIME_2_2_ART_ASSETS')


def icon_specs_22():
    s = []
    # the career stages' achievements (Collection.achievements(): career-star, career-legendary)
    s.append(('achievements', 'career_star', ART22_SRC, 'achievement_prime_time_star.png'))  # «PRIME TIME STAR»
    # Beta 2.2 mini hotfix: achievement_prime_legend.png is the PRIME LEGEND achievement — «Победитель легенды» (BOSS
    # FIGHT, its reward is the title PRIME LEGEND). Beta 2.2 had put it under `career_legendary` (LEGENDARY PRODUCTION);
    # the id is now `prime_legend` (same bytes) and LEGENDARY PRODUCTION keeps its stage emblem.
    s.append(('achievements', 'prime_legend', ART22_SRC, 'achievement_prime_legend.png'))  # «Победитель легенды»
    # MY COLLECTION's sections (the overview's cards and their tabs)
    for sec in ('achievements', 'seasons', 'league', 'rewards'):
        s.append(('sections', sec, ART22_SRC, f'collection_{"prime_league" if sec == "league" else sec}_v2.png'))
    # the career's «Цели сезона» (career.ts GOALS) — the picture id; the goal id is in rewardArt.ts CAREER_GOAL_ART
    for f, gid in [
        ('season_goal_rising_star.png', 'rising_star'),  # fans_2500 «Восходящая звезда»
        ('season_goal_big_league.png', 'big_league'),  # pro_win «Большая лига»
        ('season_goal_roster_expansion.png', 'roster_expansion'),  # sign_second «Расширение состава»
        ('season_goal_perfect_timing.png', 'perfect_timing'),  # perfect_3 «Идеальный тайминг»
        ('season_goal_prime_time_champion.png', 'prime_time_champion'),  # champion_win «Чемпион прайм-тайма»
        ('Золотая звезда стремительного роста.png', 'golden_rating'),  # rating_70 «Золотой рейтинг» (see the report)
    ]:
        s.append(('goals', gid, ART22_SRC, f))
    # titles: the PRIME LEAGUE road's three titles (league.config.ts track) and DAILY PRIME STREAK's 7-day title
    s.append(('titles', 'on_air', ART22_SRC, 'title_on_air.png'))  # «ON AIR»
    s.append(('titles', 'voice_of_air', ART22_SRC, 'title_voice_of_air.png'))  # «ГОЛОС ЭФИРА»
    s.append(('titles', 'prime_time', ART22_SRC, 'title_prime_time.png'))  # «ПРАЙМ-ТАЙМ»
    s.append(('titles', 'title_daily_regular', ART22_SRC, 'reward_daily_broadcast.png'))  # «ЕЖЕДНЕВНЫЙ ЭФИР» (7 days)
    # DAILY PRIME STREAK's 100-day victory effect «РАССВЕТ ПРАЙМ-ТАЙМА» (a preview like the other effects)
    s.append(('effects', 'victory_daily_sunrise', ART22_SRC, 'reward_prime_dawn.png'))
    return s


def check_mapped(folder, specs):
    used = {find_src(f, w) for _, _, f, w in specs if f == folder}
    for f in os.listdir(folder):
        if f.lower().endswith('.png') and f not in used:
            sys.exit(f'{os.path.basename(folder)}/{f!r} is not mapped to a game id')


def icons_22(manifest):
    """Beta 2.2: only the new pictures — earlier entries and files are left exactly as they are."""
    manifest['icon']['sizes'] = ICON_SIZES
    specs = icon_specs_22()
    for group, icon_id, _, _ in specs:
        if icon_id in manifest['icons'].get(group, {}) and not manifest['icons'][group][icon_id]['src'].startswith('PRIME_TIME_2_2_ART_ASSETS/'):
            sys.exit(f'{group}/{icon_id} already has an earlier picture — not replaced')
    for spec in specs:
        icon(*spec, manifest)
    check_mapped(ART22_SRC, specs + icon_specs_signal())


# ------------------------------------------------------------------ Beta 2.2 FINAL (the owner's last batch)
# PRIME_TIME_2_3_WINTER_COLLECTION_ART/ — 14 PNG (1254² / 1312×1199 RGBA). Each mapped to an EXISTING game id after
# looking at the picture (docs/BETA_2_2_FINAL_RELEASE_REPORT.md §1); `--icons-23` adds exactly these entries and files,
# every earlier entry and WebP stays byte for byte (the earlier career emblem `rewards/career` too: the new one is a
# separate id the reward section points to).
ART23_SRC = os.path.join(ROOT, 'PRIME_TIME_2_3_WINTER_COLLECTION_ART')


def icon_specs_23():
    s = []
    # the MASTERY achievements (achievements.config.ts) that now have a picture — «Полный состав» and «Идеальный эфир»
    # have none in the batch and keep the game's drawing
    s.append(('achievements', 'mastery_combo', ART23_SRC, 'achievement_combo_show.png'))  # mastery-combo «Комбо-шоу»
    s.append(('achievements', 'mastery_champion', ART23_SRC, 'achievement_five_champion_broadcasts.png'))  # mastery-champion
    # MY COLLECTION: the «Купленное» section (overview card and tab head)
    s.append(('sections', 'shop', ART23_SRC, 'collection_purchased_v3.png'))
    # the reward CATEGORY «Карьера продюсера» (MY COLLECTION → Награды; never the mode button «Карьера»)
    s.append(('rewards', 'career_producer', ART23_SRC, 'reward_career_emblem_v3.png'))
    # titles: BOSS FIGHT's PRIME LEGEND (cosmetics title_prime_legend — not the achievement «PRIME LEGEND» art) and the
    # winter grand prize WINTER CHAMPION (title_winter_champion)
    s.append(('titles', 'title_prime_legend', ART23_SRC, 'title_prime_legend.png'))
    s.append(('titles', 'title_winter_champion', ART23_SRC, 'winter_champion_title.png'))
    # WINTER SHOWDOWN's currency CANDY CANES (events.config.ts currency.id)
    s.append(('currency', 'candy_canes', ART23_SRC, 'WINTER_EVENT_CANDY_CANE_TOKEN.png'))
    # six of the nine winter quests (events.config.ts quests[].id); first_snow, holiday_hat_trick and garland_combo have
    # no picture in the batch and keep their icons
    for f, qid in [
        ('WINTER_GOAL_IDEAL_DEFENSE.png', 'frost_guard'),  # «FROST GUARD»: 40 perfect dodges or blocks — the shield
        ('WINTER_GOAL_MIDNIGHT_RATING.png', 'midnight_rating'),  # rating 80+
        ('WINTER_GOAL_HOLIDAY_BROADCAST.png', 'holiday_broadcast'),
        ('WINTER_GOAL_CHAMPIONS_EVE.png', 'champions_eve'),  # «PRO+»
        ('WINTER_GOAL_LEAGUE_SNOWFALL.png', 'league_snowfall'),
        ('WINTER_GOAL_CANDY_CANE_COLLECTOR.png', 'cane_collector'),
    ]:
        s.append(('winter', f'quest_{qid}', ART23_SRC, f))
    # the DAILY PRIME STREAK gift in its winter dress (only while WINTER SHOWDOWN runs)
    s.append(('winter', 'daily_gift', ART23_SRC, 'WINTER_DAILY_REWARD_GIFT.png'))
    return s


def icons_23(manifest):
    """Beta 2.2 final: only the last batch — earlier entries and files are left exactly as they are."""
    manifest['icon']['sizes'] = ICON_SIZES
    specs = icon_specs_23()
    for group, icon_id, _, _ in specs:
        if icon_id in manifest['icons'].get(group, {}) and not manifest['icons'][group][icon_id]['src'].startswith('PRIME_TIME_2_3_WINTER_COLLECTION_ART/'):
            sys.exit(f'{group}/{icon_id} already has an earlier picture — not replaced')
    for spec in specs:
        icon(*spec, manifest)
    check_mapped(ART23_SRC, specs)


# ------------------------------------------------------------------ Beta 2.3 (PRIME_TIME_2_3_UI_MODE_ART_REFINED)
# 20 PNG: the main screen's icons and the bottom bar's skins, the game modes, three achievements and the winter event's
# last pictures. Each mapped to an EXISTING game id after looking at the picture (docs/BETA_2_3_DEVELOPMENT_REPORT.md);
# `--icons-24` adds exactly these entries and files, every earlier entry and WebP stays byte for byte.
ART24_SRC = os.path.join(ROOT, 'PRIME_TIME_2_3_UI_MODE_ART_REFINED')


def icon_specs_24():
    s = []
    # the main screen (MenuScreen): the DAILY gift button, «Пригласить друга», PRIME SHOP's and CARDS' icons, the settings
    # button of the bottom bar (the file says «theme»: the game's fourth button is the settings gear — the same picture)
    s.append(('ui', 'gift', ART24_SRC, 'ui_home_gift_icon_v3.png'))
    s.append(('ui', 'invite', ART24_SRC, 'ui_home_invite_friend_icon_v3.png'))
    s.append(('ui', 'shop', ART24_SRC, 'ui_prime_shop_icon_v3.png'))
    s.append(('ui', 'cards', ART24_SRC, 'ui_cards_icon_v3.png'))
    s.append(('ui', 'settings', ART24_SRC, 'ui_nav_theme_button_v3.png'))
    # the modes: the career's CLASSIC DUEL / SURVIVAL / PRIME CHALLENGE cards (ModesScreen), PRIME LEAGUE's PRIME SQUAD
    # and PRIME RUSH series (LeagueScreen). The mode icons «Карьера» / «PRIME LEAGUE» (modes/career, modes/league) stay.
    s.append(('modes', 'classic_duel', ART24_SRC, 'mode_classic_duel_icon_v3.png'))
    s.append(('modes', 'survival', ART24_SRC, 'mode_survival_icon_v3.png'))
    s.append(('modes', 'prime_challenge', ART24_SRC, 'mode_prime_challenge_icon_v3.png'))
    s.append(('modes', 'prime_squad', ART24_SRC, 'mode_prime_squad_icon_v3.png'))
    s.append(('modes', 'prime_rush', ART24_SRC, 'mode_prime_rush_icon_v3.png'))
    # the achievements that still wore the game's drawing: «Полный состав» (a signed contract card with the roster),
    # «Идеальный эфир» (the show-rating gauge at its top), RISING BROADCAST (a TV with a rising chart)
    s.append(('achievements', 'mastery_roster', ART24_SRC, 'achievement_full_roster.png'))
    s.append(('achievements', 'mastery_rating', ART24_SRC, 'achievement_perfect_broadcast.png'))
    s.append(('achievements', 'career_rising', ART24_SRC, 'achievement_career_rising_broadcast.png'))
    # WINTER SHOWDOWN: the three quests without a picture and the event's emblem
    s.append(('winter', 'quest_first_snow', ART24_SRC, 'winter_quest_first_snow.png'))  # FIRST SNOW ON AIR
    s.append(('winter', 'quest_holiday_hat_trick', ART24_SRC, 'winter_quest_holiday_hat_trick.png'))  # HOLIDAY WINS
    s.append(('winter', 'quest_garland_combo', ART24_SRC, 'winter_quest_garland_combo.png'))  # GARLAND COMBO
    s.append(('winter', 'event_emblem', ART24_SRC, 'winter_event_emblem.png'))
    return s


# ------------------------------------------------------------------ Beta 2.4 (the owner's INVITE SIGNAL preview)
# PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png (1254² RGBA) — the legendary dash effect of PRIME INVITE CASE, a
# preview like the other dash effects (EFFECT_ART). `--invite-signal` adds exactly this entry and its two WebP files.
def icon_specs_signal():
    return [('effects', 'dash_invite_signal', ART22_SRC, 'dash_invite_signal.png')]


def icons_signal(manifest):
    """Beta 2.4: only INVITE SIGNAL's preview — earlier entries and files are left exactly as they are."""
    specs = icon_specs_signal()
    for group, icon_id, _, _ in specs:
        if icon_id in manifest['icons'].get(group, {}) and manifest['icons'][group][icon_id]['src'] != 'PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png':
            sys.exit(f'{group}/{icon_id} already has an earlier picture — not replaced')
    for spec in specs:
        icon(*spec, manifest)
    check_mapped(ART22_SRC, icon_specs_22() + specs)


def nav_skin(nav_id, wanted, l, r, manifest):
    """A bottom-bar button skin: trimmed to the picture, the aspect kept, made at NAV_HEIGHTS."""
    name = find_src(ART24_SRC, wanted)
    src = os.path.join(ART24_SRC, name)
    im, alpha = open_clean(src)
    ys, xs = np.where(alpha > 8)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    pic = im.crop(box)
    entry = {'src': os.path.relpath(src, ROOT), 'sha256': sha(src), 'size': list(im.size), 'bbox': list(box), 'aspect': round(pic.size[0] / pic.size[1], 4), 'l': l, 'r': r, 'out': {}}
    for size, h in NAV_HEIGHTS.items():
        w = round(h * pic.size[0] / pic.size[1])
        rel = f'ui/nav/{size}/{nav_id}.webp'
        path = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        pic.resize((w, h), Image.LANCZOS).save(path, **WEBP)
        entry['out'][size] = {'file': rel, 'w': w, 'h': h, 'bytes': os.path.getsize(path), 'sha256': sha(path)}
    manifest['icons'].setdefault('nav', {})[nav_id] = entry


def icons_24(manifest):
    """Beta 2.3: only the new pictures — earlier entries and files are left exactly as they are."""
    manifest['icon']['sizes'] = ICON_SIZES
    manifest['icon']['navHeights'] = NAV_HEIGHTS
    specs = icon_specs_24()
    for group, icon_id, _, _ in specs:
        if icon_id in manifest['icons'].get(group, {}) and not manifest['icons'][group][icon_id]['src'].startswith('PRIME_TIME_2_3_UI_MODE_ART_REFINED/'):
            sys.exit(f'{group}/{icon_id} already has an earlier picture — not replaced')
    for spec in specs:
        icon(*spec, manifest)
    for nav_id, (wanted, l, r) in NAV_SKINS.items():
        nav_skin(nav_id, wanted, l, r, manifest)
    check_mapped(ART24_SRC, specs + [('nav', i, ART24_SRC, w) for i, (w, _, _) in NAV_SKINS.items()])


def find_src(folder, wanted):
    """The one file of `folder` whose name, spaces trimmed, is `wanted` (exits on none or several)."""
    nfc = lambda x: unicodedata.normalize('NFC', x.strip())
    hits = [f for f in os.listdir(folder) if nfc(f) == nfc(wanted)]
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
    specs = icon_specs() + icon_specs_22() + icon_specs_23() + icon_specs_signal()
    for spec in specs:
        icon(*spec, manifest)
    used = {(folder, find_src(folder, wanted)) for _, _, folder, wanted in specs}
    for folder in (RANK_ART_SRC, FX_ART_SRC, ART22_SRC, ART23_SRC):
        for f in os.listdir(folder):
            if f.lower().endswith('.png') and (folder, f) not in used:
                sys.exit(f'{os.path.basename(folder)}/{f!r} is not mapped to a game id')


def main():
    path = os.path.join(ROOT, 'scripts', 'art', 'manifest.json')
    if '--invite-signal' in sys.argv:
        with open(path, encoding='utf-8') as fh:
            manifest = json.load(fh)
        icons_signal(manifest)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        kb = sum(o['bytes'] for g, i, _, _ in icon_specs_signal() for o in manifest['icons'][g][i]['out'].values()) / 1024
        print(f'Beta 2.4: INVITE SIGNAL, {kb:.0f} KB of WebP; earlier entries untouched')
        return
    if '--icons-24' in sys.argv:
        with open(path, encoding='utf-8') as fh:
            manifest = json.load(fh)
        icons_24(manifest)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        n = len(icon_specs_24()) + len(NAV_SKINS)
        kb = sum(o['bytes'] for g, i, _, _ in icon_specs_24() for o in manifest['icons'][g][i]['out'].values()) / 1024
        kb += sum(o['bytes'] for e in manifest['icons']['nav'].values() for o in e['out'].values()) / 1024
        print(f'Beta 2.3: {n} pictures, {kb:.0f} KB of WebP; earlier entries untouched')
        return
    if '--icons-23' in sys.argv:
        with open(path, encoding='utf-8') as fh:
            manifest = json.load(fh)
        icons_23(manifest)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        n = len(icon_specs_23())
        kb = sum(o['bytes'] for g, i, _, _ in icon_specs_23() for o in manifest['icons'][g][i]['out'].values()) / 1024
        print(f'Beta 2.2 final: {n} pictures, {kb:.0f} KB of WebP; earlier entries untouched')
        return
    if '--icons-22' in sys.argv:
        with open(path, encoding='utf-8') as fh:
            manifest = json.load(fh)
        icons_22(manifest)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        n = len(icon_specs_22())
        kb = sum(o['bytes'] for g, i, _, _ in icon_specs_22() for o in manifest['icons'][g][i]['out'].values()) / 1024
        print(f'Beta 2.2: {n} pictures, {kb:.0f} KB of WebP; earlier entries untouched')
        return
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
