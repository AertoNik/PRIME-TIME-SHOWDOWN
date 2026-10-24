// Headless checks for Alpha 1.8.8 — PRIME SHOP (npm run shop): the catalog of seven items, honest
// prices and no payment, ownership kept apart from trying on and from the save, the server's save
// rules, the two skins (base fighters untouched, same skeleton, muzzles and animation), the four
// shop cosmetics and LUCIEN's seasonal states on fixture clocks. In-memory saves, no browser.
import { Vector3 } from 'three';
import { COSMETICS, type CosmeticId } from '../src/config/cosmetics.config';
import { EVENTS } from '../src/config/events.config';
import { FIGHTERS } from '../src/config/fighters';
import { LOOKS } from '../src/config/looks';
import {
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  SHOP_PRICES_RUB,
  SHOP_PRICE_STATUS,
  approvedPriceRub,
  SHOP_SALES_OPEN,
  SKINS,
  SKU_OF_COSMETIC,
  SKU_OF_SKIN,
  type ShopSku,
} from '../src/config/shop.config';
import { Rng } from '../src/core/math';
import { SHOP_OFFERS, currentOffer } from '../src/config/offer.config';
import { devGrant, ownsPaid, paidSource, setEntitlements } from '../src/meta/entitlements';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { Shop } from '../src/meta/Shop';
import { DASH_FX, VICTORY_FX } from '../src/render/cosmeticFx';
import { getRigGeometry } from '../src/render/FighterModel';
import { defaultInput, FighterAnimator, type AnimInput } from '../src/render/FighterAnimator';
import { defForLook, ModelCache } from '../src/render/ModelCache';
import type { FighterRig } from '../src/render/FighterModel';
import { canonicalJSON, cloudCopyOf, readCloudText } from '../src/net/cloudSave';
import { olderSave, save176 } from './lib/fixtures';
import { rigPrint } from './lib/rigPrint';
import { cp, fs, nodeModule, os, path, proc } from './lib/node';
import { ROOT } from './lib/backendKit';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;

class MemSave {
  data: SaveData = defaultSave();
  saves = 0;
  save(): void {
    this.saves++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data))); // round-trip like localStorage
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}
const T = (iso: string) => Date.parse(iso);
function world(at: string, data?: SaveData) {
  const store = new MemSave();
  if (data) store.data = data;
  let now = T(at);
  const events = new EventManager(store as unknown as SaveSystem, { clock: () => now });
  const shop = new Shop(store as unknown as SaveSystem, events, events.collection);
  return { store, events, shop, col: events.collection, setNow: (iso: string) => ((now = T(iso)), events.refresh()) };
}
const ALL_SKUS: ShopSku[] = ['skin_ray_neon_runner', 'skin_bruno_casino_boss', 'fx_prime_broadcast', 'fx_phantom_dash', 'fx_golden_confetti', 'fx_vhs_card_frame', 'fighter_lucien'];
const PAID: CosmeticId[] = ['frame_prime_broadcast', 'dash_prime_phantom', 'victory_golden_confetti', 'card_vhs'];

// ------------------------------------------------------------------ the catalog
{
  check('catalog: exactly the seven approved items', SHOP_ITEMS.length === 7 && SHOP_ITEMS.map((i) => i.sku).join() === ALL_SKUS.join());
  check('catalog: sku ids are unique', new Set(SHOP_ITEMS.map((i) => i.sku)).size === 7);
  check(
    'catalog: the approved names',
    SHOP_ITEMS.map((i) => i.name).join('|') === 'RAY: NEON RUNNER|BRUNO: CASINO BOSS|PRIME BROADCAST|PHANTOM DASH|GOLDEN CONFETTI|VHS CARD FRAME|LUCIEN: THE NIGHT STAR',
  );
  check('catalog: three categories (skins, effects, fighters), every item in one of them, none empty', SHOP_CATEGORIES.map((c) => c.id).join() === 'skins,effects,fighters' && SHOP_ITEMS.every((i) => SHOP_CATEGORIES.some((c) => c.id === i.category)) && SHOP_CATEGORIES.every((c) => SHOP_ITEMS.some((i) => i.category === c.id)));
  check('catalog: every card has a type line, a description and what changes', SHOP_ITEMS.every((i) => i.kind && i.desc.length > 40 && i.highlights.length >= 3));
  check('catalog: skins point to existing fighters, cosmetics to PRIME SHOP items in the collection, LUCIEN to the seasonal star', SHOP_ITEMS.every((i) => (i.skin ? SKINS[i.skin].fighter === i.fighter && i.category === 'skins' : i.cosmetic ? COSMETICS[i.cosmetic].paid === true && COSMETICS[i.cosmetic].source === 'shop' && i.category === 'effects' : i.fighter === 'lucien' && !!FIGHTERS.lucien.seasonal)));
  check('catalog: each sku sells one thing (lookups both ways)', PAID.every((c) => SHOP_ITEMS.find((i) => i.sku === SKU_OF_COSMETIC[c])?.cosmetic === c) && Object.values(SKINS).every((s) => SHOP_ITEMS.find((i) => i.sku === SKU_OF_SKIN[s.id])?.skin === s.id));
  // 1.8.8 final: the owner approved six prices on 23.10.2026 (item by item); LUCIEN's stays only proposed
  check('prices: approved by the owner item by item — RAY 99, BRUNO 149, PRIME BROADCAST 49, PHANTOM DASH 49, GOLDEN CONFETTI 49, VHS CARD FRAME 49 ₽', ALL_SKUS.map((s) => SHOP_PRICES_RUB[s]).join() === '99,149,49,49,49,49,299' && ALL_SKUS.filter((s) => s !== 'fighter_lucien').every((s) => SHOP_PRICE_STATUS[s] === 'approved' && approvedPriceRub(s) === SHOP_PRICES_RUB[s]));
  check('prices: LUCIEN 299 ₽ is only PROPOSED — never shown as a price, never charged (a seasonal fighter: sold only after his event AND the owner\'s decision)', SHOP_PRICE_STATUS.fighter_lucien === 'proposed' && approvedPriceRub('fighter_lucien') === null);
  check('sales are closed and the offer link points to the real installed page (public/legal/ru/offer.html)', SHOP_SALES_OPEN === false && SHOP_OFFERS.every((o) => fs.existsSync(path.join(ROOT, 'public', o.url.replace(/^https:\/\/primetimeshowdown\.online\//, '')))) && (currentOffer() === null || currentOffer()!.url.endsWith('/legal/ru/offer.html')));
  const w = world('2026-10-22T12:00:00Z');
  check('prices: the shop shows the approved price («99 ₽», «149 ₽», «49 ₽») — and «ПОКА НЕ В ПРОДАЖЕ» while real sales are closed', SHOP_ITEMS.filter((i) => !i.fighter || i.skin).every((i) => w.shop.state(i).price === `${SHOP_PRICES_RUB[i.sku]} ₽` && w.shop.state(i).status === 'soon' && w.shop.state(i).chip === 'ПОКА НЕ В ПРОДАЖЕ'), SHOP_ITEMS.map((i) => w.shop.state(i).price).join('|'));
  // no fake payment: a purchase request never succeeds, never grants, never creates anything
  const before = JSON.stringify(w.store.data);
  const refusals = ALL_SKUS.flatMap((s) => [w.shop.requestPurchase(s, false), w.shop.requestPurchase(s, true)]);
  check('purchase: every request is refused with a reason (guest and signed in), nothing is owned after it', refusals.every((r) => r.ok === false && r.message.length > 10) && ALL_SKUS.every((s) => !ownsPaid(s)));
  check('purchase: a request writes nothing to the save', JSON.stringify(w.store.data) === before && w.store.saves === 0);
  const shopTs = read('src/meta/Shop.ts');
  const screenTs = read('src/ui/screens/ShopScreen.ts');
  // (1.8.8 stage 4: payments live in PRIME CHECKOUT and the server — the shop itself stays free of them)
  const noComments = (t: string) => t.replace(/^\s*(\/\/|\*).*$/gm, '');
  check('no payment code in the shop itself: no network, no payment provider, no entitlement setter (PRIME CHECKOUT and the server do that)', !/fetch\(|XMLHttpRequest|auth\.robokassa|robokassa\.js|RK\.|setEntitlements\(/i.test(noComments(screenTs)) && !/fetch\(|XMLHttpRequest|auth\.robokassa|robokassa\.js|RK\.|setEntitlements\(/i.test(noComments(shopTs)));
  check('no free-grant button: devGrant only from the dev-build hook (?shopgrant), never from a screen', !/devGrant|devShopGrant/.test(screenTs) && /import\.meta\.env\.DEV\) devShopGrant/.test(read('src/game/Game.ts')) && /if \(!import\.meta\.env\?\.DEV/.test(read('src/meta/entitlements.ts')));
  check('dev grant is inert outside a dev build (here: no Vite env)', devGrant(['skin_ray_neon_runner']) === false && !ownsPaid('skin_ray_neon_runner'));
  // nothing in the game hands a paid item out: the ids appear only in the catalog, the looks and the
  // visual mappings — no event exchange, career stage, boss reward or achievement names them
  const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const srcFiles = walk('src');
  const paidIds = /frame_prime_broadcast|dash_prime_phantom|victory_golden_confetti|card_vhs|skin_ray_neon_runner|skin_bruno_casino_boss|fx_prime_broadcast|fx_phantom_dash|fx_golden_confetti|fx_vhs_card_frame/;
  const allowed = ['src/config/cosmetics.config.ts', 'src/config/shop.config.ts', 'src/game/ThemeManager.ts', 'src/render/cosmeticFx.ts'];
  const leaks = srcFiles.filter((f) => paidIds.test(read(f)) && !allowed.includes(f.split(path.sep).join('/')));
  check('no reward path names a paid item (events, career, boss, achievements, modes)', leaks.length === 0, leaks.join());
  const setters = srcFiles.filter((f) => /setEntitlements\(|devGrant\(/.test(read(f).replace(/^\s*(\/\/|\*).*$/gm, '')) && !/entitlements\.ts$|Shop\.ts$/.test(f));
  // 1.8.8 stage 4: the one caller of setEntitlements is the accounts layer, with the SERVER's answer for the signed-in PRIME ID
  check('ownership changes only through entitlements.ts: setEntitlements only from AccountRuntime (the server\'s answer), devGrant only from the dev hook', setters.length === 1 && /src[\\/]game[\\/]AccountRuntime\.ts$/.test(setters[0]), setters.join());
}

// ------------------------------------------------------------------ the four cosmetics
{
  const slots = PAID.map((id) => COSMETICS[id].slot).join();
  check('cosmetics: four new ids in the existing slots (frame, dash, victory, card style)', slots === 'broadcastFrame,dashFx,victoryFx,cardStyle');
  check('cosmetics: their own ids — the seasonal PURPLE PHANTOM / PUMPKIN VICTORY / SPOOKY / pumpkin cards stay separate', !PAID.some((id) => ['dash_phantom', 'victory_pumpkin', 'frame_spooky', 'card_pumpkin'].includes(id)) && ['dash_phantom', 'victory_pumpkin', 'frame_spooky', 'card_pumpkin'].every((id) => id in COSMETICS && !COSMETICS[id as CosmeticId].paid));
  check('cosmetics: each plays its own effect (dash → prime, victory → gold), the seasonal ones keep theirs', DASH_FX.dash_prime_phantom === 'prime' && DASH_FX.dash_phantom === 'phantom' && VICTORY_FX.victory_golden_confetti === 'gold' && VICTORY_FX.victory_pumpkin === 'pumpkin');
  const theme = read('src/game/ThemeManager.ts');
  check('cosmetics: the frame and the card style reach the page (data-frame="prime", data-card-style="vhs")', /frame_prime_broadcast'\) root\.dataset\.frame = 'prime'/.test(theme) && /card_vhs'\) root\.dataset\.cardStyle = 'vhs'/.test(theme));
  const css = read('src/styles/main.css');
  check('VHS CARD FRAME: frame only — no rule hides or recolours the cost, the icon or the name', !/data-card-style='vhs'\][^{]*\.(gem|ic)\b[^{]*\{/.test(css) && !/\.vhs-set \.card \.(gem|ic)\b/.test(css) && /data-card-style='vhs'\] \.hand-card\.combo-ready/.test(css));
  check('PRIME BROADCAST: the frame never takes taps and sits on the screen edges', /:root\[data-frame='prime'\] \.bc-frame,[\s\S]{0,80}\{[\s\S]{0,200}pointer-events: none !important;/.test(css));
  const fx = read('src/render/cosmeticFx.ts');
  const bv = read('src/render/BattleView.ts');
  check('effects: pure visuals — the cosmetic effects touch only the VFX pools, not the match', !/Match|FighterSim|combat\//.test(fx.replace(/^\/\/.*$/gm, '')) && /dashBurst\(this\.vfx, rng, s\.dashFx, dc, e\.fromX, e\.fromZ, e\.toX, e\.toZ\)/.test(bv));
}

// ------------------------------------------------------------------ ownership vs try-on vs the save
{
  setEntitlements([]);
  const w = world('2026-10-22T12:00:00Z');
  const ray = SHOP_ITEMS[0];
  check('guest: sees all seven items with an honest state', w.shop.states().length === 7 && w.shop.states().every((s) => s.chip && s.price && s.note));
  check('guest: no card says «Приобретено», «НАДЕТО» or «В КОЛЛЕКЦИИ» without real ownership', w.shop.states().every((s) => !s.owned && s.price !== 'Приобретено' && s.chip !== 'НАДЕТО' && s.chip !== 'В КОЛЛЕКЦИИ'));
  check('not owned: a skin cannot be worn, the fighter keeps the standard look', !w.shop.setSkin('ray', 'ray_neon_runner') && w.shop.lookFor('ray') === 'ray' && w.store.saves === 0);
  check('not owned: a shop cosmetic cannot be worn or granted by the collection', !w.col.setEquipped('card_vhs', true) && !w.col.grant('card_vhs', 'prime-shop') && w.col.equipped('cardStyle') === null);
  // a forged save: the wardrobe says «wear it», the collection says «owned» — nothing is honoured
  const forged = defaultSave() as any;
  forged.shop = { skins: { ray: 'ray_neon_runner', bruno: 'bruno_casino_boss' }, equip: { cardStyle: 'card_vhs', dashFx: 'dash_prime_phantom' } };
  forged.cosmetics.owned = ['card_vhs', 'dash_prime_phantom', 'frame_spooky'];
  forged.cosmetics.equipped = { cardStyle: 'card_vhs' };
  const clean = sanitize(JSON.parse(JSON.stringify(forged)));
  check('save: paid ids never stay in cosmetics.owned / equipped (only the earned seasonal item survives)', clean.cosmetics.owned.join() === 'frame_spooky' && !clean.cosmetics.equipped.cardStyle);
  check('save: the wardrobe choices load (kept, they are only choices)', clean.shop.skins.ray === 'ray_neon_runner' && clean.shop.equip.cardStyle === 'card_vhs');
  const fw = world('2026-10-22T12:00:00Z', clean);
  check('forged save: still nothing owned or worn — standard looks, standard slots', fw.shop.lookFor('ray') === 'ray' && fw.shop.lookFor('bruno') === 'bruno' && fw.col.equipped('cardStyle') === null && fw.col.equipped('dashFx') === null && !fw.col.owns('card_vhs'));
  const junk = sanitize({ version: 12, shop: { skins: { ray: 'bruno_casino_boss', nika: 'nope', zz: 'ray_neon_runner' }, equip: { cardStyle: 'dash_prime_phantom', dashFx: 'dash_phantom', title: 'x' }, extra: 1 } });
  check('save: unknown or mismatched skin / item ids are dropped, the save still loads', JSON.stringify(junk.shop) === '{"skins":{},"equip":{}}');
  check('save: an old save without the field gets an empty wardrobe', JSON.stringify(sanitize({ version: 11, money: 10 }).shop) === '{"skins":{},"equip":{}}');
  check('save: the schema version is unchanged by PRIME SHOP', defaultSave().version === 12);

  // the server's purchase list (stage 4) is the only way to own: simulated here with setEntitlements
  setEntitlements(['skin_ray_neon_runner', 'fx_vhs_card_frame']);
  const ow = world('2026-10-22T12:00:00Z');
  check('a confirmed purchase is «Приобретено»; worn it is «НАДЕТО»', paidSource('skin_ray_neon_runner') === 'purchase' && ow.shop.state(ray).price === 'Приобретено' && ow.shop.state(ray).chip === 'В КОЛЛЕКЦИИ');
  check('owned skin: worn, saved once, shown everywhere through lookFor', ow.shop.setSkin('ray', 'ray_neon_runner') && ow.store.saves === 1 && ow.shop.lookFor('ray') === 'ray_neon_runner' && ow.shop.state(ray).status === 'equipped' && ow.shop.state(ray).chip === 'НАДЕТО');
  check('a development test grant is never shown as a purchase (the shop and the collection say «тестовый доступ (dev)»)', /const source = paidSource\(item\.sku\);/.test(read('src/meta/Shop.ts')) && /source === 'dev' \? 'Тестовый доступ \(dev\)'/.test(read('src/meta/Shop.ts')) && /const src = paidSource\(SKU_OF_SKIN\[id\]\);/.test(read('src/ui/screens/CollectionScreen.ts')) && /src === 'dev' \? 'Тест \(dev\)'/.test(read('src/ui/screens/CollectionScreen.ts')));
  setEntitlements(['skin_ray_neon_runner', 'fx_vhs_card_frame'], true, 'test');
  check('a right from Robokassa\'s TEST mode (staging, the demonstration) is «Тестовая покупка», never «Приобретено» — in the shop and in the collection', paidSource('skin_ray_neon_runner') === 'test' && ow.shop.state(ray).price === 'Тестовая покупка' && /не покупка/.test(ow.shop.state(ray).note) && /src === 'test' \? 'Тестовая покупка'/.test(read('src/ui/screens/CollectionScreen.ts')));
  setEntitlements(['skin_ray_neon_runner', 'fx_vhs_card_frame']);
  check('owned skin: choosing it again writes nothing new (no duplicate records)', ow.shop.setSkin('ray', 'ray_neon_runner') && ow.store.saves === 1 && Object.keys(ow.store.data.shop.skins).length === 1);
  check('a skin only fits its own fighter', !ow.shop.setSkin('bruno', 'ray_neon_runner' as any) && !ow.shop.setSkin('bruno', 'bruno_casino_boss'));
  check('taking it off returns the standard look', ow.shop.setSkin('ray', null) && ow.shop.lookFor('ray') === 'ray' && !('ray' in ow.store.data.shop.skins));
  ow.shop.setSkin('ray', 'ray_neon_runner');
  check('owned cosmetic: worn in its slot from the wardrobe field, never in save.cosmetics', ow.col.setEquipped('card_vhs', true) && ow.col.equipped('cardStyle') === 'card_vhs' && ow.store.data.shop.equip.cardStyle === 'card_vhs' && !ow.store.data.cosmetics.owned.includes('card_vhs'));
  ow.col.grant('card_pumpkin', 'halloween-2026');
  check('both owned: the player picks the seasonal card style or the shop one (one slot, one item)', ow.col.setEquipped('card_pumpkin', true) && ow.col.equipped('cardStyle') === 'card_pumpkin' && !ow.store.data.shop.equip.cardStyle && ow.col.setEquipped('card_vhs', true) && ow.col.equipped('cardStyle') === 'card_vhs');
  check('the seasonal item stays in the collection whatever is worn', ow.col.owns('card_pumpkin'));
  setEntitlements([]);
  check('entitlement gone (signed out, refund): nothing paid is shown — the standard look, the earned card style is back', ow.shop.lookFor('ray') === 'ray' && ow.col.equipped('cardStyle') === 'card_pumpkin' && ow.store.data.shop.skins.ray === 'ray_neon_runner');
  check('the career is untouched by the wardrobe (money, fighters, decks)', ow.store.data.money === defaultSave().money && JSON.stringify(ow.store.data.fighters) === JSON.stringify(defaultSave().fighters));
  const screen = read('src/ui/screens/ShopScreen.ts');
  const preview = screen.slice(screen.indexOf('private showPreview'), screen.indexOf('private zoom(d'));
  check('try-on writes nothing: the preview only puts a look on the pedestal (no save, no wardrobe, no grant)', /g\.showcase\.show\(look, accent\)/.test(preview) && !/save\(|setSkin|setEquipped|grant|setEntitlements/.test(preview));
  const leave = screen.slice(screen.indexOf('private leaveItem'), screen.indexOf('private endDrag'));
  check('closing the fitting room shows the fighter as really worn again', /this\.g\.showcase\.show\(this\.g\.fighterLook\(sel\)/.test(leave));
}

// ------------------------------------------------------------------ the server keeps paid ids out of a cloud save
{
  const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
  const V = req('./validate.js');
  const R = req('./save_rules.js');
  const ok = (o: any) => V.checkSaveText(canonicalJSON(o));
  const base = () => JSON.parse(JSON.stringify(defaultSave()));
  check('server rules: paid cosmetics are not in the save-owned list, only in the wardrobe list', PAID.every((id) => !(id in R.cosmetics) && R.shopCosmetics[id] === COSMETICS[id].slot) && R.skins.ray_neon_runner === 'ray' && R.skins.bruno_casino_boss === 'bruno');
  check('server: the game\'s own save (with the empty wardrobe) is accepted', ok(base()).ok === true);
  const a = base();
  a.shop = { skins: { ray: 'ray_neon_runner' }, equip: { cardStyle: 'card_vhs' } };
  check('server: wardrobe choices are accepted (they grant nothing)', ok(a).ok === true);
  const b = base();
  b.cosmetics.owned = ['card_vhs'];
  check('server: a save claiming a PRIME SHOP item in cosmetics.owned is refused', ok(b).ok === false);
  const c = base();
  c.cosmetics.owned = ['frame_spooky'];
  c.cosmetics.equipped = { broadcastFrame: 'frame_prime_broadcast' };
  check('server: wearing a PRIME SHOP item through cosmetics.equipped is refused', ok(c).ok === false);
  const d = base();
  d.shop = { skins: { bruno: 'ray_neon_runner' }, equip: {} };
  const e = base();
  e.shop = { skins: {}, equip: { dashFx: 'card_vhs' } };
  const f = base();
  f.shop = { skins: {}, equip: {}, owned: ['skin_ray_neon_runner'] };
  check('server: a skin on the wrong fighter, an item in the wrong slot or an «owned» list in the wardrobe is refused', ok(d).ok === false && ok(e).ok === false && ok(f).ok === false);
}

// ------------------------------------------------------------------ compatibility: old saves, PRIME CLOUD, the live server
{
  setEntitlements([]);
  const olds: [string, Record<string, any>][] = [...Array.from({ length: 11 }, (_, i) => [`v${i + 1}`, olderSave(i + 1)] as [string, Record<string, any>]), ['1.7.6 career', save176()]];
  const bad: string[] = [];
  for (const [name, raw] of olds) {
    const d = sanitize(JSON.parse(JSON.stringify(raw)));
    const w = world('2026-10-22T12:00:00Z', d);
    const looksOk = (Object.keys(FIGHTERS) as (keyof typeof FIGHTERS)[]).every((f) => w.shop.lookFor(f) === FIGHTERS[f].look);
    if (JSON.stringify(d.shop) !== '{"skins":{},"equip":{}}' || !looksOk || w.shop.states().length !== 7) bad.push(name);
  }
  check(`old saves (schemas 1–11 and the rich 1.7.6 career): load with an empty wardrobe, every fighter in the standard look, the shop works`, bad.length === 0, bad.join());
  const rich = sanitize(JSON.parse(JSON.stringify(save176())));
  const rw = world('2026-10-22T12:00:00Z', rich);
  check('old saves: earned seasonal items, LUCIEN and the career stay as they were', rw.events.ownsFighter('lucien') && rw.shop.state(SHOP_ITEMS[6]).status === 'received' && rich.cosmetics.owned.length === sanitize(JSON.parse(JSON.stringify(save176()))).cosmetics.owned.length && rich.money === save176().money);

  // PRIME CLOUD: the wardrobe goes up and comes back; a forged paid claim in the cloud text is cleaned
  const mine = defaultSave();
  mine.shop = { skins: { ray: 'ray_neon_runner' }, equip: { victoryFx: 'victory_golden_confetti' } };
  const up = cloudCopyOf(JSON.stringify(mine));
  const back = readCloudText(up.text);
  check('PRIME CLOUD: the wardrobe choices travel in the cloud copy and read back the same', back.ok && JSON.stringify(back.ok && back.data.shop) === JSON.stringify(mine.shop));
  const forged = JSON.parse(up.text);
  forged.cosmetics.owned = ['card_vhs', 'victory_golden_confetti'];
  forged.cosmetics.equipped = { cardStyle: 'card_vhs' };
  const fb = readCloudText(JSON.stringify(forged));
  const fw = fb.ok ? world('2026-10-22T12:00:00Z', fb.data) : null;
  check('PRIME CLOUD: a cloud text claiming paid items is read without them — nothing owned, nothing worn', !!fw && fb.ok && !fb.data.cosmetics.owned.some((id) => PAID.includes(id)) && fw.col.equipped('cardStyle') === null && fw.col.equipped('victoryFx') === null);
  check('PRIME CLOUD: «shop» is a known field of 1.8.8 (not kept twice as an unknown one)', fb.ok && !('shop' in fb.extra));

  // the server that is live now (the 1.8.4 bundle in server-bundle/, read in a temp folder — the
  // real server is not contacted): it keeps accepting the new client's saves and refuses paid claims
  const bundle = path.join(ROOT, 'server-bundle', 'prime-server-1.8.4-alpha.tar.gz');
  if (fs.existsSync(bundle)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-184-'));
    try {
      cp.execFileSync('tar', ['-xzf', bundle, '-C', tmp, 'backend/pb_hooks/lib/validate.js', 'backend/pb_hooks/lib/save_rules.js']);
      const req184 = nodeModule.createRequire(path.join(tmp, 'backend', 'pb_hooks', 'lib', 'x.js'));
      const V184 = req184('./validate.js');
      const ok184 = (o: any) => V184.checkSaveText(canonicalJSON(o)).ok === true;
      const plain = JSON.parse(JSON.stringify(defaultSave()));
      const worn = JSON.parse(JSON.stringify(mine));
      const claim = JSON.parse(JSON.stringify(defaultSave()));
      claim.cosmetics.owned = ['card_vhs'];
      check('live 1.8.4 server: accepts a 1.8.8 save, with and without wardrobe choices (no server update needed for them)', ok184(plain) && ok184(worn));
      check('live 1.8.4 server: refuses a save claiming a PRIME SHOP item (an id it does not know)', !ok184(claim));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else check('live 1.8.4 server bundle present for the compatibility check (server-bundle/prime-server-1.8.4-alpha.tar.gz)', false);
}

// ------------------------------------------------------------------ the skins
{
  const baseline = JSON.parse(read('scripts/lib/look-baseline.json')).looks as Record<string, string>;
  const changed = Object.keys(baseline).filter((id) => rigPrint(id) !== baseline[id]);
  check(`original looks: all ${Object.keys(baseline).length} fighters and rivals have exactly their pre-1.8.8 models`, changed.length === 0 && Object.keys(baseline).length === 13, changed.join());
  for (const sk of Object.values(SKINS)) {
    const L = LOOKS[sk.look];
    const B = LOOKS[sk.fighter];
    const g = getRigGeometry(sk.look);
    const gb = getRigGeometry(sk.fighter);
    check(`${sk.name}: an alternate look of ${FIGHTERS[sk.fighter].name} — same body, weapon and animation set`, L.base === sk.fighter && L.body === B.body && L.weapon === B.weapon && defForLook(sk.look) === FIGHTERS[sk.fighter]);
    // (the face may differ — eye height, mouth: that is the skin's own face)
    check(`${sk.name}: same skeleton, muzzles and weapon hand as the original`, Object.keys(g.bones).join() === Object.keys(gb.bones).join() && JSON.stringify([g.muzzleR, g.muzzleL, g.weaponHand, g.headCenterY]) === JSON.stringify([gb.muzzleR, gb.muzzleL, gb.weaponHand, gb.headCenterY]));
    const differs = (bone: string) => {
      const x = (g.bones as any)[bone].toon.attributes.position.count;
      const y = (gb.bones as any)[bone].toon.attributes.position.count;
      return x !== y;
    };
    check(`${sk.name}: really new geometry — clothes, hair and face, hands, weapon (not a recolour)`, rigPrint(sk.look) !== rigPrint(sk.fighter) && differs('torso') && differs('head') && differs('weaponR') && L.hair.style !== B.hair.style && L.top.style !== B.top.style);
    const tris = (geo: typeof g) => Object.values(geo.bones).reduce((n: number, b: any) => n + [b.toon, b.glow].reduce((m: number, x: any) => m + (x ? (x.index ? x.index.count : x.attributes.position.count) / 3 : 0), 0), 0);
    const vale = tris(getRigGeometry('vale'));
    check(`${sk.name}: mobile budget — ${Math.round(tris(g) / 1000)}k triangles (the original ${Math.round(tris(gb) / 1000)}k, largest existing look ${Math.round(vale / 1000)}k)`, tris(g) < tris(gb) * 1.5 && tris(g) < vale);
  }

  // animation: a skin moves exactly like its fighter — same random stream, same inputs, same joints
  // and the muzzles in the same places, frame after frame (busy fight, dash, hits, stun, KO, victory)
  const joints = (rig: FighterRig): number[] => {
    const out: number[] = [];
    for (const o of [rig.roll, rig.hips, rig.spine, rig.head, rig.shoulderL, rig.shoulderR, rig.elbowL, rig.elbowR, rig.legL, rig.legR, rig.kneeL, rig.kneeR]) out.push(o.rotation.x, o.rotation.y, o.rotation.z);
    out.push(rig.body.position.x, rig.body.position.y, rig.body.position.z);
    return out;
  };
  const realRandom = Math.random;
  const run = (look: string) => {
    // the rig first (three.js draws random ids while building it), then the same random stream for
    // a fresh animator of each look
    const { rig } = new ModelCache().get(look);
    let seed = 0x9e3779b9;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const def = defForLook(look);
    const anim = new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle);
    const rng = new Rng(4242);
    const inp: AnimInput = defaultInput();
    inp.combat = true;
    inp.maxSpeed = 4.5;
    anim.reset(0);
    const frames: number[][] = [];
    const v = new Vector3();
    let finite = true;
    for (let i = 0; i < 60 * 14; i++) {
      const t = i / 60;
      if (i % 50 === 0) {
        const a = rng.range(-Math.PI, Math.PI);
        inp.vx = Math.sin(a) * rng.range(0, 4.5);
        inp.vz = Math.cos(a) * rng.range(0, 4.5);
        inp.facing = rng.range(-Math.PI, Math.PI);
      }
      inp.x += inp.vx / 60;
      inp.z += inp.vz / 60;
      inp.fireIn = (t % 0.6) - 0.05;
      if (i % 36 === 0) anim.fire(i % 72 === 0 ? 1 : 0, i % 180 === 0);
      if (i % 97 === 0) anim.hit(rng.range(-1, 1), rng.range(-1, 1), i % 194 === 0);
      if (i % 240 === 120) anim.dash(rng.range(-1, 1), rng.range(-1, 1));
      if (i % 300 === 200) anim.cast('throw');
      inp.stunned = t > 6 && t < 7;
      if (i === 60 * 10) anim.ko();
      if (i === 60 * 11) anim.reset(0);
      if (i === 60 * 12) anim.victory(1);
      anim.update(1 / 60, inp);
      rig.root.updateMatrixWorld(true);
      const f = joints(rig);
      for (const m of rig.muzzles) f.push(...m.getWorldPosition(v).toArray());
      f.push(...rig.handR.getWorldPosition(v).toArray());
      if (f.some((x) => !Number.isFinite(x))) finite = false;
      frames.push(f);
    }
    Math.random = realRandom;
    return { frames, finite };
  };
  for (const sk of Object.values(SKINS)) {
    const a = run(sk.fighter);
    const b = run(sk.look);
    let worst = 0;
    for (let i = 0; i < a.frames.length; i++) for (let k = 0; k < a.frames[i].length; k++) worst = Math.max(worst, Math.abs(a.frames[i][k] - b.frames[i][k]));
    check(`${sk.name}: moves exactly like ${FIGHTERS[sk.fighter].name} — joints, hands and muzzles identical through run, fire, dash, card, hits, stun, KO and victory (max diff ${worst.toExponential(1)})`, a.finite && b.finite && worst < 1e-9);
  }
}

// ------------------------------------------------------------------ LUCIEN on fixture clocks
{
  setEntitlements([]);
  const ev = EVENTS.find((e) => e.fighters?.some((f) => f.fighter === 'lucien'))!;
  const lucien = SHOP_ITEMS.find((i) => i.sku === 'fighter_lucien')!;
  const w = world('2026-10-10T12:00:00Z');
  check('LUCIEN: one calendar — the shop reads Halloween Premiere from EventManager', w.events.fighterSeason('lucien')?.event.id === ev.id && ev.start === '2026-10-20T00:00:00Z' && ev.end === '2026-11-04T00:00:00Z');
  check('LUCIEN before the season: a seasonal star, nothing to buy', w.shop.state(lucien).status === 'upcoming' && w.shop.requestPurchase('fighter_lucien', true).ok === false);
  w.setNow('2026-10-22T12:00:00Z');
  const st = w.shop.state(lucien);
  check('LUCIEN during the season: only the old way — 500 PUMPKIN TOKENS, «за рубли не продаётся»', st.status === 'seasonal' && /500 PUMPKIN TOKENS/.test(st.price) && /За рубли не продаётся/.test(st.note));
  check('LUCIEN during the season: the purchase request points to the event, never to money', w.shop.requestPurchase('fighter_lucien', true).code === 'seasonal');
  check('LUCIEN: the token price is still 500 and the opening still works through the event', w.events.fighterOffer('lucien')?.cost === 500 && !w.events.buyFighter('lucien').ok);
  w.events.progress(ev.id).tokens = 500;
  check('LUCIEN opened with tokens during the season: the shop says «ПОЛУЧЕН»', w.events.buyFighter('lucien').ok && w.shop.state(lucien).status === 'received' && w.shop.state(lucien).chip === 'ПОЛУЧЕН');
  w.setNow('2026-11-04T00:00:01Z');
  check('LUCIEN after the season, opened: still «ПОЛУЧЕН», still in the roster, no second offer', w.shop.state(lucien).status === 'received' && w.events.ownsFighter('lucien') && w.events.fighterVisible('lucien') && w.shop.requestPurchase('fighter_lucien', true).code === 'owned');
  const late = world('2026-11-04T00:00:01Z');
  const ls = late.shop.state(lucien);
  check('LUCIEN after the season, not opened: a future paid way («ПОКА НЕ В ПРОДАЖЕ», price not approved, not sold now)', ls.status === 'after_season' && ls.chip === 'ПОКА НЕ В ПРОДАЖЕ' && ls.price === 'Цена уточняется' && late.shop.requestPurchase('fighter_lucien', true).code === 'not_on_sale');
  check('LUCIEN: no second fighter id — the shop item is the same «lucien»', lucien.fighter === 'lucien' && Object.keys(FIGHTERS).filter((k) => k.includes('lucien')).length === 1);
  setEntitlements(['fighter_lucien']);
  // 1.8.8 stage 4: the paid way is wired — the server's right opens him, the save never holds it
  check('LUCIEN: a paid right (confirmed by the server) opens him in the roster — never written into the save', late.events.ownsFighter('lucien') && late.store.data.fighters.lucien.unlocked === false);
  setEntitlements([]);
}

// ------------------------------------------------------------------ performance loops (headless)
{
  // the fitting room reuses one rig per look: trying on again and again builds nothing new
  const cache = new ModelCache();
  const first = new Set<unknown>();
  for (const look of ['ray', 'ray_neon_runner', 'bruno', 'bruno_casino_boss', 'lucien']) first.add(cache.get(look).rig);
  let same = true;
  for (let i = 0; i < 200; i++) for (const look of ['ray', 'ray_neon_runner', 'bruno', 'bruno_casino_boss', 'lucien']) if (!first.has(cache.get(look).rig)) same = false;
  check('loop: 200 rounds of switching looks reuse the same five rigs (no new geometry or materials)', same && first.size === 5);
  const geo1 = getRigGeometry('ray_neon_runner');
  check('loop: a skin\'s geometry is built once and cached', getRigGeometry('ray_neon_runner') === geo1);
  // the shop's state and the wardrobe stay cheap and stable over many open/close rounds
  setEntitlements(['skin_ray_neon_runner']);
  const w = world('2026-10-22T12:00:00Z');
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    w.shop.states();
    w.shop.setSkin('ray', i % 2 ? 'ray_neon_runner' : null);
  }
  const ms = performance.now() - t0;
  check(`loop: 2000 rounds of catalog states + wear/take off stay fast (${ms.toFixed(0)} ms) and leave one clean record`, ms < 3000 && JSON.stringify(w.store.data.shop) === '{"skins":{"ray":"ray_neon_runner"},"equip":{}}');
  setEntitlements([]);
  const scr = read('src/ui/screens/ShopScreen.ts');
  check('screen: listeners are added once (constructor), timers are cleared and late effects check the page token', (scr.match(/addEventListener\(/g) ?? []).length === 6 && /clearTimeout\(this\.autoTimer\)/.test(scr) && /this\.alive !== token/.test(scr));
}

console.log(failed ? `shop: FAILED (${failed} of ${passed + failed})` : `shop: OK (${passed} checks)`);
proc.exitCode = failed ? 1 : 0;
