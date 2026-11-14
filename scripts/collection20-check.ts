// Headless checks for Beta 2.0 MY COLLECTION and personal effects (npm run collection20):
//   * personal effects: a fighter's own dash / victory effect wins over the common one, 'off' wears none, an absent
//     entry inherits; only an OWNED item of the right slot can be set; an item no longer owned is skipped (inherit);
//     «применить ко всем» clears the fighters' own choices of that slot only; one item serves every fighter;
//   * with no personal choice the game wears exactly what Alpha 1.9.9 wore (commonFor ≡ equippedFor);
//   * the save: `fx` is sanitised (junk dropped), an older save without it loads with {}, the field round-trips, and an
//     Alpha 1.9.9 client (the publish copy, if it is still 1.9.9) keeps it unchanged as an unknown top-level field;
//   * the server's save check accepts a valid `fx` and refuses unknown fighters, slots and items;
//   * the collection hides nothing owned: every owned cosmetic shows in exactly the section of its source.
import { COSMETICS, COSMETIC_ORDER, COSMETIC_SLOTS, FX_SLOTS, type CosmeticId } from '../src/config/cosmetics.config';
import { FIGHTER_ORDER } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';
import { Collection } from '../src/meta/Collection';
import { defaultSave, sanitize, sanitizeFx, unknownFields, type SaveData } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { fs, nodeModule, path, proc } from './lib/node';
import { ROOT } from './lib/backendKit';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

function store(d: SaveData = defaultSave()) {
  let saves = 0;
  const s = { data: d, save: () => void saves++ };
  return { s, col: new Collection(s), saves: () => saves };
}

// ---------------------------------------------------------------- personal effects
{
  const { s, col } = store();
  const d = s.data;
  for (const f of ['kai', 'rina', 'ace'] as FighterId[]) d.fighters[f].unlocked = true;
  // game items (owned through the save — the PRIME SHOP ones need a confirmed purchase, entitlements.ts)
  for (const id of ['dash_phantom', 'dash_candy_comet', 'victory_pumpkin', 'victory_midnight_confetti'] as CosmeticId[]) col.grant(id, 'test', undefined, false);
  const same = FIGHTER_ORDER.every((f) => COSMETIC_SLOTS.every((slot) => col.equippedFor(slot, f) === col.commonFor(slot, f)));
  check('no personal choice: every fighter wears exactly the 1.9.9 common choice', same);
  col.setEquipped('dash_phantom', true);
  check('a common effect is worn by every fighter (one item, no second purchase)', FIGHTER_ORDER.every((f) => col.equippedFor('dashFx', f) === 'dash_phantom'));
  check('a fighter\'s own effect wins over the common one', col.setFighterFx('kai', 'dashFx', 'dash_candy_comet') && col.equippedFor('dashFx', 'kai') === 'dash_candy_comet' && col.equippedFor('dashFx', 'ray') === 'dash_phantom');
  check('«off» is not «inherit»: the fighter wears none', col.setFighterFx('rina', 'dashFx', 'off') && col.equippedFor('dashFx', 'rina') === null && col.fighterFx('rina', 'dashFx') === 'off');
  check('null goes back to the common choice', col.setFighterFx('rina', 'dashFx', null) && col.equippedFor('dashFx', 'rina') === 'dash_phantom' && !d.fx.rina);
  check('an item not owned can never be set', !col.setFighterFx('ace', 'dashFx', 'dash_glitch') && !col.setFighterFx('ace', 'dashFx', 'dash_comet'));
  check('an item of another slot, an unknown fighter or slot is refused', !col.setFighterFx('ace', 'dashFx', 'victory_pumpkin' as CosmeticId) && !col.setFighterFx('zzz' as FighterId, 'dashFx', 'dash_phantom'));
  check('victory effects are personal too', col.setFighterFx('ace', 'victoryFx', 'victory_midnight_confetti') && col.effectiveEquipped('ace').victoryFx === 'victory_midnight_confetti' && col.effectiveEquipped('ray').victoryFx === undefined);
  check('wornBy names who really wears an item', col.wornBy('dash_phantom', ['ray', 'kai', 'rina', 'ace']).join() === 'ray,rina,ace' && col.wornBy('dash_candy_comet', ['ray', 'kai']).join() === 'kai');
  col.equipForAll('dash_candy_comet');
  check('«ко всем» clears the own choices of THAT slot only', FIGHTER_ORDER.every((f) => col.equippedFor('dashFx', f) === 'dash_candy_comet') && !d.fx.kai && d.fx.ace?.victoryFx === 'victory_midnight_confetti');
  // a personal choice of an item that is no longer owned (a refund, a broken save) is skipped: the fighter inherits
  col.setFighterFx('kai', 'victoryFx', 'victory_pumpkin');
  d.cosmetics.owned = d.cosmetics.owned.filter((x) => x !== 'victory_pumpkin');
  check('an item no longer owned is never worn (the fighter inherits)', col.equippedFor('victoryFx', 'kai') === col.commonFor('victoryFx', 'kai') && col.equippedFor('victoryFx', 'kai') !== 'victory_pumpkin');
  check('card styles, frames and titles stay common (no personal slot)', !(FX_SLOTS as readonly string[]).includes('cardStyle') && !(FX_SLOTS as readonly string[]).includes('title') && FX_SLOTS.join() === 'dashFx,victoryFx');
}

// ---------------------------------------------------------------------- the save
{
  const raw = { kai: { dashFx: 'dash_comet', victoryFx: 'off', cardStyle: 'card_holo' }, rina: { dashFx: 'victory_pumpkin' }, nobody: { dashFx: 'dash_comet' }, ace: 'x', ray: { dashFx: 'nope' } };
  const fx = sanitizeFx(raw);
  check('sanitize keeps real fighters, the two slots and items of that slot (or off)', JSON.stringify(fx) === JSON.stringify({ kai: { dashFx: 'dash_comet', victoryFx: 'off' } }));
  const old = defaultSave() as unknown as Record<string, unknown>;
  delete old.fx;
  const loaded = sanitize(old);
  check('an older save without fx loads with {} (everyone inherits, as before)', JSON.stringify(loaded.fx) === '{}');
  const withFx = { ...defaultSave(), fx: { kai: { dashFx: 'dash_comet' } } };
  const again = sanitize(JSON.parse(JSON.stringify(withFx)));
  check('fx round-trips through the save', again.fx.kai?.dashFx === 'dash_comet' && !('fx' in unknownFields(withFx as unknown as Record<string, unknown>)));
  // an Alpha 1.9.9 client (the publish copy while it still is 1.9.9) keeps the field it does not know
  const pub = path.join(ROOT, '..', 'PRIME TIME SHOWDOWN', 'src', 'meta', 'SaveSystem.ts');
  const pubText = fs.existsSync(pub) ? (fs.readFileSync(pub, 'utf8') as string) : '';
  if (pubText && !/\bfx:\s*\{\}/.test(pubText)) {
    const oldMod = await import(pub);
    const extra = oldMod.unknownFields(withFx as unknown as Record<string, unknown>);
    const written = JSON.parse(JSON.stringify({ ...extra, ...oldMod.sanitize(withFx), version: oldMod.VERSION }));
    check('an Alpha 1.9.9 client keeps fx as an unknown top-level field and writes it back unchanged', JSON.stringify(written.fx) === JSON.stringify(withFx.fx));
  } else check('(the publish copy is no longer 1.9.9 — the old-client case was checked while it was)', true);
}

// -------------------------------------------------------------- the server's check
{
  const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
  const V = req('./validate.js');
  const base = { ...defaultSave(), fx: {} } as Record<string, unknown>;
  const ok = (fx: unknown) => V.checkSaveText(canonicalJSON({ ...base, fx })).ok === true;
  check('the server accepts a valid fx (items of the slot, off, PRIME SHOP items)', ok({ kai: { dashFx: 'dash_comet', victoryFx: 'off' }, ray: { victoryFx: 'victory_pumpkin' } }));
  check('the server refuses an unknown fighter, slot or item, or an item of another slot', !ok({ zzz: { dashFx: 'dash_comet' } }) && !ok({ kai: { cardStyle: 'card_holo' } }) && !ok({ kai: { dashFx: 'nope' } }) && !ok({ kai: { dashFx: 'victory_pumpkin' } }) && !ok('x'));
  check('a save without fx is still accepted (older clients)', V.checkSaveText(canonicalJSON(defaultSave())).ok === true);
}

// --------------------------------------------------------- nothing owned is hidden
{
  const src = fs.readFileSync('src/ui/screens/CollectionScreen.ts', 'utf8') as string;
  const { col } = store();
  for (const id of COSMETIC_ORDER) if (!COSMETICS[id].paid && !COSMETICS[id].personal) col.grant(id, 'test', undefined, false);
  const shown = col.cosmetics();
  const sources = new Set(COSMETIC_ORDER.map((id) => COSMETICS[id].source));
  check('every owned game item is visible in the collection', COSMETIC_ORDER.filter((id) => !COSMETICS[id].paid && !COSMETICS[id].personal).every((id) => shown.some((v) => v.def.id === id && v.owned)));
  check('every item source has its section (shop, season, league, career / boss / daily → awards)', [...sources].every((x) => ['shop', 'season', 'league', 'career', 'boss', 'daily'].includes(x)) && /c\.source === 'shop' \? 'shop' : c\.source === 'season' \? 'season' : c\.source === 'league' \? 'league' : 'rewards'/.test(src));
  check('the screen only shows and equips: no grant / purchase / server call', !/\.grant\(|devGrant|fetch\(|checkout|setEntitlements/i.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')));
  check('the old 1.x tabs still open their place (checkout → purchases, events → seasons)', src.includes("const map: Record<string, Section> = { all: 'overview', cosmetics: 'shop', achievements: 'achievements', seasons: 'seasons' };"));
  // Beta 2.0 final — the tab bar jumped back to its start: every tab rebuilt the whole screen with innerHTML
  const code = src.replace(/^\s*(\/\/|\*).*$/gm, '');
  const renders = code.match(/this\.render\(/g)?.length ?? 0;
  check('the screen is built once on opening; a tab, a category, a filter or an action refreshes it in place', renders === 2 && /this\.render\(false\);\s*requestAnimationFrame\(\(\) => this\.revealTab\(false\)\)/.test(code) && /if \(!scroller \|\| !top \|\| !nav \|\| !body\) \{\s*this\.render\(\);/.test(code));
  check('a tab keeps the tab bar element (only the changed tabs are re-created inside it) and never rebuilds the open tab', /act === 'sec'[\s\S]{0,260}this\.refreshInPlace\(true\)/.test(code) && /swapToggles\(nav\.querySelectorAll/.test(code) && /if \(sec === this\.section && t\.closest\('\.cl-nav'\)\) return;/.test(code));
  check('a category or a filter only refreshes the list (its chip row keeps its scroll)', /act === 'sub'[\s\S]{0,160}this\.pickChip\(t\);\s*this\.refreshResults\(\);/.test(code) && /act === 'filter'[\s\S]{0,160}this\.pickChip\(t\);\s*this\.refreshResults\(\);/.test(code));
  check('strips and chip rows of the same section get their horizontal scroll back; the bar scrolls itself, never the page', /keepScrollX\(body\)/.test(code) && /'\.cl-subnav, \.cl-strip, \.cl-chips'/.test(code) && /nav\.scrollTo\(\{ left, behavior: 'smooth' \}\)/.test(code) && !/scrollIntoView/.test(code));
  check('the big view and a fighter\'s effects refresh in place and keep their own scroll (no closing and re-opening)', !/close\(\);\s*this\.(render|refreshInPlace)\(\);\s*this\.openItem/.test(code) && (code.match(/panel\.scrollTop = y;/g)?.length ?? 0) === 2);
  const css = fs.readFileSync('src/styles/main.css', 'utf8') as string;
  // Beta 2.0 patch (owner's iPhone): the tab bar was 2 px wider than the screen on each side (−14 px against a 12 px
  // padding), and a list that is overflow-y: auto is overflow-x: auto too — iPhone dragged the whole collection sideways
  const rule = (sel: string) => new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  check('patch: the tab bar and the chip row use exactly the scroller\'s 12 px padding (never wider than the screen); the active tab\'s glow has room', /margin: 10px -12px 0;/.test(rule('.cl-nav')) && /padding: 4px 12px 12px;/.test(rule('.cl-nav')) && /margin: 0 -12px 10px;/.test(rule('.cl-subnav')) && /padding: 2px 12px;/.test(rule('.cl-subnav')) && !/-14px/.test(rule('.cl-nav') + rule('.cl-subnav')) && /\.col-scroll \{\s*padding: 0 12px 16px;/.test(css));
  check('patch: only the bars scroll sideways — the collection\'s own scroller never does (overflow-x hidden); grids cannot grow past the screen', /\.cl20 \.col-scroll \{\s*overflow-x: hidden;\s*overscroll-behavior-x: none;/.test(css) && /repeat\(4, minmax\(0, 1fr\)\)/.test(rule('.cl-stats').concat(css.slice(css.lastIndexOf('.cl-stats {')))) && /92px minmax\(0, 1fr\) minmax\(0, 1fr\) 14px/.test(css) && /\.cl-sec \{\s*grid-template-columns: 44px minmax\(0, 1fr\);/.test(css));
  check('patch: the menu logo (and its LIVE tag) starts below the top bar — the currency pills never cover LIVE', /\.menu-head \{\s*margin-top: 20px;\s*\}\s*@media \(max-height: 700px\) \{\s*\.menu-head \{\s*margin-top: 24px;/.test(css));
  check('iPhone: the bars scroll by touch without pulling the page (overscroll contained, touch-action: manipulation on the chips; Beta 2.1: no legacy nested touch-scrolling layer)', /\.cl-nav,\s*\.cl-subnav,\s*\.cl-strip \{\s*overscroll-behavior-x: contain;/.test(css) && /touch-action: manipulation;/.test(css) && !/\.cl-nav,\s*\.cl-subnav,\s*\.cl-strip \{\s*-webkit-overflow-scrolling/.test(css));
  // Beta 2.1 (owner's iPhone screenshot): an in-place class change was half-repainted — the tabs, chips and league picks
  // switch by re-creating the changed buttons (swapToggles), never by flipping a class on a live button
  const dom = fs.readFileSync('src/ui/dom.ts', 'utf8') as string;
  check('Beta 2.1: tabs and chips switch by re-creating the changed buttons (the bar and its scroll stay), not by an in-place class flip', /export function swapToggles/.test(dom) && /b\.replaceWith\(fresh\)/.test(dom) && /swapToggles\(nav\.querySelectorAll<HTMLElement>\('button\[data-sec\]'\)/.test(code) && /swapToggles\(row\.querySelectorAll<HTMLElement>\('\.cl-chip'\)/.test(code) && !/classList\.toggle\('on'/.test(code));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ncollection20: FAILED (${failed} of ${checks.length})` : `\ncollection20: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
