// Headless checks for Alpha 1.9.5 Part 1 — SEASONAL ITEMS and the new PRIME SHOP cosmetics (npm run seasonal):
//   the universal seasonal rule (characters, effects, skins) before / during / after an event, on fixture clocks and
//   a synthetic «New Year» event with a skin in its exchange; ownership for tokens vs by purchase (one id, never two);
//   the server's clock for the calendar; the server's rules (shop_rules seasons, save_rules exchanges, the cloud's
//   «season_closed» guard) on a temporary PocketBase with copied hooks; the six effects wired into the game.
// No browser, no network beyond 127.0.0.1, no payment.
import { COSMETICS, COSMETIC_ORDER, type CosmeticId } from '../src/config/cosmetics.config';
import { EVENTS, type EventDef } from '../src/config/events.config';
import { FIGHTERS } from '../src/config/fighters';
import { LOOKS } from '../src/config/looks';
import { seasonOf, seasonalSkus } from '../src/config/seasonal';
import { SHOP_ITEMS, SKINS, SKU_OF_COSMETIC, approvedPriceRub, rubToKop, shopItem, type ShopSku } from '../src/config/shop.config';
import { GOODS_R5, SHOP_OFFERS, currentOffer, offerSells } from '../src/config/offer.config';
import { setEntitlements } from '../src/meta/entitlements';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { noteServerTime, resetServerClock, serverNow, serverTimeKnown } from '../src/meta/serverClock';
import { Shop } from '../src/meta/Shop';
import { DASH_FX, VICTORY_FX } from '../src/render/cosmeticFx';
import { canonicalJSON } from '../src/net/cloudSave';
import { HOOKS, ROOT, binariesReady, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, nodeModule, os, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 19890, smtp: 11989, mailUi: 19891 };
const API = `http://127.0.0.1:${PORTS.api}`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
function section(t: string): void {
  console.log(`\n— ${t}`);
}
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;
const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const V = req('./validate.js');
const R = req('./save_rules.js');
const SR = req('./shop_rules.js');

class MemSave {
  data: SaveData = defaultSave();
  saves = 0;
  save(): void {
    this.saves++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}
const T = (iso: string) => Date.parse(iso);
function world(at: string, registry?: EventDef[], data?: SaveData) {
  const store = new MemSave();
  if (data) store.data = data;
  let now = T(at);
  const events = new EventManager(store as unknown as SaveSystem, { clock: () => now, ...(registry ? { registry } : {}) });
  const shop = new Shop(store as unknown as SaveSystem, events, events.collection);
  return { store, events, shop, col: events.collection, setNow: (iso: string) => ((now = T(iso)), events.refresh()) };
}

// A future season, data only: a «New Year» event whose exchange has a cosmetic AND a PRIME SHOP skin
const NEW_YEAR: EventDef = {
  id: 'newyear-test',
  title: 'NEW YEAR GALA',
  subtitle: 'test',
  themeId: 'winter',
  start: '2026-12-20T00:00:00Z',
  end: '2027-01-10T00:00:00Z',
  announceDays: 7,
  tagline: 'test',
  currency: { id: 'snow', name: 'SNOW TOKENS', short: ['жетон', 'жетона', 'жетонов'], icon: 'pumpkin' },
  earnings: { win: 4, rating: [], perCombo: 1, comboCap: 3, dailyCap: 60 },
  quests: [{ id: 'q', title: 'Q', desc: 'q', metric: { kind: 'wins' }, target: 1, reward: 10, icon: 'star' }],
  shop: [{ cosmetic: 'victory_pumpkin', cost: 90 }],
  skins: [{ skin: 'nika_stage_idol', cost: 300 }],
};
const REG = [...EVENTS, NEW_YEAR];

// ======================================================================== the rule (client)
function ruleChecks(): void {
  section('Единое сезонное правило: персонажи, эффекты, облики');
  setEntitlements([]);
  const seasonal = seasonalSkus();
  check('the seasonal items of the real calendar: LUCIEN and the three Halloween effects sold after the season (the same ids as the exchange)', seasonal.sort().join() === ['fighter_lucien', 'season_halloween_cards', 'season_pumpkin_victory', 'season_spooky_broadcast'].sort().join(), seasonal.join());
  check('one item, one id: each seasonal shop entry IS its exchange\'s item (fighter / cosmetic id), no shop-only copy', seasonal.every((s) => { const it = shopItem(s); const ss = seasonOf(it)!; return it.fighter && !it.skin ? ss.event.fighters!.some((f) => f.fighter === it.fighter) : ss.event.shop.some((x) => x.cosmetic === it.cosmetic); }));
  check('PURPLE PHANTOM stays a seasonal reward only (PRIME SHOP already sells its own PHANTOM DASH) — an exchange item without a shop entry is never sold', !SHOP_ITEMS.some((i) => i.cosmetic === 'dash_phantom') && SHOP_ITEMS.some((i) => i.cosmetic === 'dash_prime_phantom'));
  check('the generic rule reaches skins: a skin in a future exchange is seasonal (data only — no code per event)', seasonOf(shopItem('skin_nika_stage_idol'), REG)?.event.id === 'newyear-test' && seasonOf(shopItem('skin_nika_stage_idol'))?.event === undefined);
  check('server rules: shop_rules.seasons covers every seasonal item (fighter and cosmetics) with its event\'s dates', seasonal.every((s) => SR.seasons[s]?.event === 'halloween-2026' && SR.seasons[s].end === '2026-11-04T00:00:00Z') && Object.keys(SR.seasons).length === seasonal.length);
  check('server rules: a seasonal cosmetic is in BOTH lists — owned via the save (tokens), worn from shop.equip (purchase)', ['card_pumpkin', 'frame_spooky', 'victory_pumpkin'].every((c) => R.cosmetics[c] === COSMETICS[c as CosmeticId].slot && R.shopCosmetics[c] === COSMETICS[c as CosmeticId].slot) && !('dash_phantom' in R.shopCosmetics));
  check('server rules: save_rules.events lists the exchanges with their end (the cloud\'s season guard)', R.events['halloween-2026'].end === '2026-11-04T00:00:00Z' && R.events['halloween-2026'].cosmetics.join() === 'card_pumpkin,dash_phantom,frame_spooky,victory_pumpkin' && R.events['halloween-2026'].fighters.join() === 'lucien' && R.events['halloween-2026'].skins.length === 0);

  // ---- Halloween's effects, by the calendar
  const card = shopItem('season_halloween_cards');
  const before = world('2026-10-10T12:00:00Z');
  const sb = before.shop.state(card);
  check('BEFORE its event: «СЕЗОННЫЙ», not sold, nothing to buy', sb.status === 'upcoming' && sb.chip === 'СЕЗОННЫЙ' && /Откроется в HALLOWEEN PREMIERE/.test(sb.price) && before.shop.requestPurchase('season_halloween_cards', true).ok === false);
  const during = world('2026-10-25T12:00:00Z');
  const sd = during.shop.state(card);
  check('DURING its event: tokens only — «СЕЗОННЫЙ», the price in PUMPKIN TOKENS, «За рубли во время события не продаётся», the purchase points to the event', sd.status === 'seasonal' && sd.price === '120 PUMPKIN TOKENS' && /За рубли во время события не продаётся/.test(sd.note) && during.shop.requestPurchase('season_halloween_cards', true).code === 'seasonal');
  during.events.progress('halloween-2026').tokens = 500;
  check('DURING: obtained in the exchange for 120 tokens (the existing exchange, unchanged)', during.events.buy('card_pumpkin').ok && during.events.tokens(during.events.active) === 380 && during.col.owns('card_pumpkin') && during.store.data.cosmetics.owned.includes('card_pumpkin'));
  const so = during.shop.state(card);
  check('…then the shop says «Получено в HALLOWEEN PREMIERE», kept for good — never offered for roubles', so.owned && (so.status === 'equipped' || so.status === 'owned') && so.price === 'Получено в HALLOWEEN PREMIERE' && /покупать не нужно/.test(so.note) && during.shop.requestPurchase('season_halloween_cards', true).code === 'owned');
  check('…and a second exchange purchase is refused (no second charge of tokens)', !during.events.buy('card_pumpkin').ok && during.events.tokens(during.events.active) === 380);
  during.setNow('2026-11-06T12:00:00Z');
  check('AFTER the event, obtained: still owned and worn — the season ending takes nothing away', during.col.owns('card_pumpkin') && during.shop.state(card).owned && during.col.equipped('cardStyle') === 'card_pumpkin');
  const after = world('2026-11-06T12:00:00Z');
  const sa = after.shop.state(card);
  check('AFTER, not obtained, the price approved (Р-18) but no offer revision in force lists it: «ОЖИДАЕТ ПРОДАЖИ 49 ₽», the note says the offer revision opens it', sa.status === 'after_season' && sa.chip === 'ОЖИДАЕТ ПРОДАЖИ' && sa.price === '49 ₽' && /войдёт в действующую редакцию оферты/.test(sa.note) && !after.shop.selling(card.sku), sa.price + ' · ' + sa.note);
  check('AFTER: the exchange is closed — tokens buy nothing any more', !after.events.buy('card_pumpkin').ok);
  // the server prices it (an approved price + an offer that lists it): on sale; an owned one never is
  const priced = Object.fromEntries(SHOP_ITEMS.map((i) => [i.sku, rubToKop(approvedPriceRub(i.sku)) ?? (i.sku === card.sku ? 4900 : null)]));
  after.shop.setServer({ selling: true, env: 'live', pricesKop: priced, chargeKop: priced });
  check('AFTER, once the server prices it: «В ПРОДАЖЕ 49 ₽», the paid way through PRIME CHECKOUT', after.shop.state(card).status === 'on_sale' && after.shop.state(card).chip === 'В ПРОДАЖЕ' && after.shop.state(card).price === '49 ₽' && after.shop.selling(card.sku));
  during.shop.setServer({ selling: true, env: 'live', pricesKop: priced, chargeKop: priced });
  check('…while for the player who got it for tokens it stays «Получено» at any price — no second sale', during.shop.state(card).owned && during.shop.requestPurchase('season_halloween_cards', true).code === 'owned');
  // bought after the season: the same id, owned through the purchase, worn from shop.equip, never in save.cosmetics
  setEntitlements(['season_halloween_cards']);
  check('BOUGHT after the season: owned through the right (the same card_pumpkin), the shop says «Приобретено»', after.col.owns('card_pumpkin') && after.shop.state(card).owned && after.shop.state(card).price === 'Приобретено');
  check('…worn from save.shop.equip — save.cosmetics never names it (a refund takes back only what the purchase gave)', after.col.setEquipped('card_pumpkin', true) && after.store.data.shop.equip.cardStyle === 'card_pumpkin' && !after.store.data.cosmetics.owned.includes('card_pumpkin') && after.col.equipped('cardStyle') === 'card_pumpkin');
  check('…the cloud accepts that save (shop.equip of a seasonal item is a known wardrobe choice)', V.checkSaveText(canonicalJSON(after.store.data)).ok === true);
  check('…the collection shows it as owned (visible), and the token exchange would refuse it', after.col.visible('card_pumpkin') && !after.events.buy('card_pumpkin').ok);
  setEntitlements([]);
  check('REFUND (the right revoked): not owned, the worn choice is ignored — the card style is the standard one again', !after.col.owns('card_pumpkin') && after.col.equipped('cardStyle') === null);
  after.shop.setServer(null);

  // ---- LUCIEN keeps working through the same calendar
  const lw = world('2026-10-25T12:00:00Z');
  const lucien = shopItem('fighter_lucien');
  check('LUCIEN (unchanged): tokens during his season, «ПОЛУЧЕН» once opened', lw.shop.state(lucien).status === 'seasonal' && lw.shop.state(lucien).price === '500 PUMPKIN TOKENS' && (() => { lw.events.progress('halloween-2026').tokens = 500; return lw.events.buyFighter('lucien').ok && lw.shop.state(lucien).status === 'received'; })());
  check('LUCIEN after the season, not opened: «ОЖИДАЕТ ПРОДАЖИ» / on sale as the server says — the same seasonal words', world('2026-11-06T12:00:00Z').shop.state(lucien).chip === 'ОЖИДАЕТ ПРОДАЖИ');

  // ---- a future season with a SKIN in its exchange
  section('Будущий сезон (данные): облик в обмене жетонов');
  const nika = shopItem('skin_nika_stage_idol');
  const ny = world('2026-12-25T12:00:00Z', REG);
  check('during the New Year test event: the skin is «СЕЗОННЫЙ» for 300 SNOW TOKENS (listed although its price is only proposed)', ny.shop.listed(nika) && ny.shop.state(nika).status === 'seasonal' && ny.shop.state(nika).price === '300 SNOW TOKENS');
  check('…not enough tokens → refused with the shortfall, nothing written', !ny.events.buySkin('nika_stage_idol').ok && ny.store.saves === 0);
  ny.events.progress('newyear-test').tokens = 320;
  check('…opened for 300 tokens: the record in save.events[…].skins, the tokens spent, saved at once', ny.events.buySkin('nika_stage_idol').ok && ny.events.tokens(ny.events.active) === 20 && ny.store.data.events['newyear-test'].skins?.[0]?.id === 'nika_stage_idol' && ny.store.saves === 1);
  check('…owned: the wardrobe offers it (source «season»), it is worn everywhere, the shop says «Получено в NEW YEAR GALA»', ny.shop.ownsSkin('nika_stage_idol') && ny.shop.skinSource('nika_stage_idol') === 'season' && ny.shop.setSkin('nika', 'nika_stage_idol') && ny.shop.lookFor('nika') === 'nika_stage_idol' && ny.shop.state(nika).price === 'Получено в NEW YEAR GALA');
  check('…a second exchange purchase is refused; a purchase for roubles is refused («owned»)', !ny.events.buySkin('nika_stage_idol').ok && ny.shop.requestPurchase('skin_nika_stage_idol', true).code === 'owned');
  const reload = world('2027-02-01T12:00:00Z', REG, sanitize(JSON.parse(JSON.stringify(ny.store.data))));
  check('…kept after the event and through a reload (sanitize keeps the record; the worn choice too)', reload.shop.ownsSkin('nika_stage_idol') && reload.shop.lookFor('nika') === 'nika_stage_idol');
  const nyAfter = world('2027-02-01T12:00:00Z', REG);
  check('after the event, not obtained: «ОЖИДАЕТ ПРОДАЖИ» (price proposed); a bought one (the right) owns the same skin', nyAfter.shop.state(nika).status === 'after_season' && (() => { setEntitlements(['skin_nika_stage_idol']); const ok = nyAfter.shop.ownsSkin('nika_stage_idol') && nyAfter.shop.skinSource('nika_stage_idol') === 'purchase'; setEntitlements([]); return ok; })());
  check('a save WITHOUT a skin record keeps exactly its earlier text (the field is written only when used)', JSON.stringify(sanitize(JSON.parse(JSON.stringify(defaultSave())))).indexOf('"skins":[') < 0 && !('skins' in sanitize(JSON.parse(JSON.stringify(during.store.data))).events['halloween-2026']));
  // the server's save rules for skin records (the real rules have no skin exchange; a copy with the test one)
  const s1 = JSON.parse(JSON.stringify(ny.store.data));
  check('server: the REAL rules refuse a skin record in an exchange that does not list it (no exchange sells a skin today)', V.checkSaveText(canonicalJSON({ ...s1, events: { 'halloween-2026': { ...s1.events['newyear-test'] } } })).ok === false);

  // ---- the server's clock
  section('Время сервера для календаря сезона');
  resetServerClock();
  const dev = Date.now();
  check('no server answer yet: the device clock (guest, offline, an older server)', !serverTimeKnown() && Math.abs(serverNow() - dev) < 50);
  check('a server time with a long round trip (> 10 s) or none is ignored', !noteServerTime(dev + 5 * 86400000, dev - 20000, dev) && !noteServerTime(undefined, dev, dev) && !serverTimeKnown());
  // the device clock set back by 5 days (the exchange would look open again): the server's time wins
  check('the server\'s time is taken (the middle of the round trip): a device clock 5 days behind no longer moves the calendar', noteServerTime(dev + 5 * 86400000, dev - 200, dev + 200) && serverTimeKnown() && Math.abs(serverNow() - (Date.now() + 5 * 86400000)) < 500);
  const sc = new EventManager(new MemSave() as unknown as SaveSystem);
  check('EventManager\'s default clock is the server clock (serverNow) — the shop and the exchange read the same calendar', Math.abs(sc.now() - serverNow()) < 50 && /this\.clock = opts\.clock \?\? serverNow;/.test(read('src/meta/EventManager.ts')));
  resetServerClock();
  check('PrimeApi reads `time` from /api/prime/config; the server sends it', /noteServerTime\(r\.time, sentAt, Date\.now\(\)\)/.test(read('src/net/PrimeApi.ts')) && /time: Date\.now\(\),/.test(read('backend/pb_hooks/lib/prime.js')));
}

// ======================================================================== the cloud's season guard (pure)
function guardChecks(): void {
  section('Защита обмена по времени сервера (validate.js seasonClosed)');
  const end = T('2026-11-04T00:00:00Z');
  const base = defaultSave() as any;
  const withCard = JSON.parse(JSON.stringify(base));
  withCard.cosmetics.owned = ['card_pumpkin'];
  withCard.events = { 'halloween-2026': { tokens: 0, earned: 120, spent: 120, quests: {}, bought: ['card_pumpkin'], fighters: [], grandClaimed: false, day: '', dayTokens: 0 } };
  const withLucien = JSON.parse(JSON.stringify(base));
  withLucien.fighters.lucien.unlocked = true;
  const t = (o: any) => canonicalJSON(o);
  check('grace: 72 hours after the end (progress made offline is still taken)', V.SEASON_GRACE_MS === 72 * 3600 * 1000);
  check('an exchange item added DURING the event (or within the grace) → taken', V.seasonClosed(t(base), t(withCard), end - 3600000) === null && V.seasonClosed(t(base), t(withCard), end + 71 * 3600000) === null);
  check('an exchange cosmetic added after the end + grace (device clock set back) → refused, the event and the item named', JSON.stringify(V.seasonClosed(t(base), t(withCard), end + 73 * 3600000)) === JSON.stringify({ event: 'halloween-2026', item: 'card_pumpkin' }));
  check('a seasonal fighter opened after the end + grace → refused', V.seasonClosed(t(base), t(withLucien), end + 30 * 86400000)?.item === 'lucien');
  check('what the stored save already had is never refused (later syncs of the same items, any change elsewhere)', V.seasonClosed(t(withCard), t({ ...withCard, money: withCard.money + 100 }), end + 30 * 86400000) === null && V.seasonClosed(t(withLucien), t(withLucien), end + 30 * 86400000) === null);
  check('removing an item is never refused (restoring an older copy)', V.seasonClosed(t(withCard), t(base), end + 30 * 86400000) === null);
  check('the guard runs inside the cloud write, only when a stored save exists (the first save / a guest career moved in is not compared), answers 422 season_closed and writes nothing', /const late = cur \? V\.seasonClosed\(cur\.getString\('data'\), up\.text, Date\.now\(\)\) : null;/.test(read('backend/pb_hooks/lib/prime.js')) && /out = \[422, \{ code: 'season_closed', event: late\.event \}\];/.test(read('backend/pb_hooks/lib/prime.js')));
  // 1.9.5 final: the honest offline model — the server check stays as it is; a PRIME ID player without a connection is told
  // BEFORE exchanging that an offline exchange reaches the cloud only within 72 hours after the event's end
  const evs = read('src/ui/screens/EventsScreen.ts');
  check('the exchange warns a PRIME ID player without a connection to PRIME CLOUD (no server time this session): kept on this device, taken by the cloud only within 72 hours after the end — with the end date', /const offline = !!this\.g\.account\?\.api\?\.sessionRecord && !serverTimeKnown\(\);/.test(evs) && /не позднее чем через 72 часа после окончания события/.test(evs) && /ev-offline/.test(read('src/styles/main.css')));
  check('the server check is NOT weakened: the grace stays 72 h, no client date is read as proof (records\' «at» never consulted)', V.SEASON_GRACE_MS === 72 * 3600 * 1000 && !/\.at\b/.test(read('backend/pb_hooks/lib/validate.js').split('function seasonClosed')[1].split('module.exports')[0]));
  check('the game names the reason in PRIME CLOUD (not a generic «server error»)', /v\.detail === 'season_closed'/.test(read('src/ui/accountUI.ts')) && /detail: s \? s\.detail : ''/.test(read('src/game/AccountRuntime.ts')));
}

// ======================================================================== offer № 5 at an exact moment (1.9.5)
function momentChecks(): void {
  section('Оферта № 5 в точный момент: 08.11.2026 09:00 МСК (06:00 UTC)');
  const r4 = SHOP_OFFERS.find((o) => o.revision === 4)!;
  const r5 = { ...r4, revision: 5, effectiveFrom: '2026-11-08T06:00:00Z', sha256: 'b'.repeat(64), items: GOODS_R5 };
  const list = [...SHOP_OFFERS, r5];
  check('the game: at 05:59:59 UTC on 08.11 revision 4 is in force, from 06:00:00 UTC revision 5 — not at the start of the day', currentOffer(T('2026-11-08T05:59:59Z'), list)?.revision === 4 && currentOffer(T('2026-11-08T06:00:00Z'), list)?.revision === 5 && currentOffer(T('2026-11-08T00:00:01Z'), list)?.revision === 4);
  check('…and the new goods are offered exactly then (offerSells by the revision in force)', !offerSells(currentOffer(T('2026-11-08T05:59:59Z'), list), 'fx_glitch_dash') && offerSells(currentOffer(T('2026-11-08T06:00:00Z'), list), 'fx_glitch_dash'));
  check('the server reads the same two forms (a day = 00:00 UTC, an ISO moment as it is) — lib/checkout.js dateOf and lib/payments.js offerInForce', /String\(s\)\.length <= 10 \? s \+ 'T00:00:00Z' : s/.test(read('backend/pb_hooks/lib/checkout.js')) && /s\.length <= 10 \? s \+ 'T00:00:00Z' : s/.test(read('backend/pb_hooks/lib/payments.js')));
  check('the legal tool registers the moment: --time=09:00 → effectiveFrom 2026-11-08T06:00:00Z, the text says «с 09:00 по московскому времени»', /--time=/.test(read('scripts/legal-release.ts')) && /\{\{TIME_MSK\}\} по московскому времени/.test(read('docs/legal-drafts/site/ru/offer.html')));
}

// ======================================================================== the six effects
function effectChecks(): void {
  section('Новые эффекты PRIME SHOP');
  const ids: CosmeticId[] = ['victory_studio_spotlights', 'victory_neon_fireworks', 'dash_glitch', 'dash_comet', 'frame_arcade', 'card_holo'];
  check('six new PRIME SHOP cosmetics: paid, source «shop», each sold by its own sku, in MY COLLECTION order', ids.every((id) => COSMETICS[id].paid === true && COSMETICS[id].source === 'shop' && !!SKU_OF_COSMETIC[id] && COSMETIC_ORDER.includes(id)));
  check('slots: two victory effects, two dash effects, a broadcast frame, a card style', ids.map((id) => COSMETICS[id].slot).join() === 'victoryFx,victoryFx,dashFx,dashFx,broadcastFrame,cardStyle');
  check('the effects have their own visual keys (not recolours of an existing key)', VICTORY_FX.victory_studio_spotlights === 'spotlights' && VICTORY_FX.victory_neon_fireworks === 'fireworks' && DASH_FX.dash_glitch === 'glitch' && DASH_FX.dash_comet === 'comet' && new Set(Object.values(VICTORY_FX)).size === Object.keys(VICTORY_FX).length && new Set(Object.values(DASH_FX)).size === Object.keys(DASH_FX).length);
  const fx = read('src/render/cosmeticFx.ts');
  check('the VFX use only the pools (bounded particle counts), late callbacks check that the page is still alive', /function spotlights\(/.test(fx) && /function fireworks\(/.test(fx) && /function glitchDash\(/.test(fx) && /function cometDash\(/.test(fx) && !/new (Mesh|Points|BufferGeometry)\(/.test(fx) && (fx.match(/alive\(\)/g) ?? []).length >= 4);
  const tm = read('src/game/ThemeManager.ts');
  const css = read('src/styles/main.css');
  check('ARCADE CABINET and HOLO FOIL: applied by the theme (data-frame / data-card-style) and previewed with the same CSS in the shop', /'frame_arcade'\) root\.dataset\.frame = 'arcade'/.test(tm) && /'card_holo'\) root\.dataset\.cardStyle = 'holo'/.test(tm) && /:root\[data-frame='arcade'\] \.bc-frame,\s*\.fd-screen\.arcade \.fd-frame/.test(css) && /:root\[data-card-style='holo'\] \.card,\s*\.holo-set \.card/.test(css));
  check('ARCADE CABINET never takes taps; HOLO FOIL keeps cost, icon and name and stops moving with reduced motion', /:root\[data-frame='arcade'\] \.bc-frame,[\s\S]{0,80}\{[\s\S]{0,200}pointer-events: none !important;/.test(css) && !/data-card-style='holo'\][^{]*\.(gem|ic)\b[^{]*\{/.test(css) && /prefers-reduced-motion[\s\S]{0,400}holo/.test(css));
  check('PRIME SHOP lists each effect with a preview of its kind (victory / dash in 3D, frame and cards in the HUD markup)', ['fx_studio_spotlights', 'fx_neon_fireworks', 'fx_glitch_dash', 'fx_comet_trail', 'fx_arcade_frame', 'fx_holo_foil'].map((s) => shopItem(s as ShopSku).preview).join() === 'confetti,confetti,dash,dash,frame,cards');
  check('the two new skins: base fighters NIKA and VEGA, their own looks (new top styles), registered as skins', SKINS.nika_stage_idol.fighter === 'nika' && SKINS.vega_star_pilot.fighter === 'vega' && LOOKS.nika_stage_idol.base === 'nika' && LOOKS.vega_star_pilot.base === 'vega' && LOOKS.nika_stage_idol.top.style === 'idol' && LOOKS.vega_star_pilot.top.style === 'pilot' && LOOKS.nika_stage_idol.hair.style === LOOKS.nika.hair.style && LOOKS.vega_star_pilot.hair.style === LOOKS.vega.hair.style && FIGHTERS.nika.look === 'nika' && FIGHTERS.vega.look === 'vega');
}

// ======================================================================== the server (temporary PocketBase)
let pb: any = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-seasonal-check-'));
const dataDir = path.join(work, 'pb_data');
const hooksDir = path.join(work, 'pb_hooks');

async function http(method: string, url: string, token = '', body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

async function serverChecks(): Promise<void> {
  section('Сервер: сезонные правила на временной базе (копия hooks)');
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  // copied hooks: the Halloween exchange ended long ago (the guard applies), the cosmetics' season of the shop still
  // running for one item (seasonal_only), and a skin in a test exchange (the save rules accept its record)
  fs.rmSync(hooksDir, { recursive: true, force: true });
  fs.cpSync(HOOKS, hooksDir, { recursive: true });
  const sr = JSON.parse(JSON.stringify(R));
  sr.events['halloween-2026'].end = '2026-01-01T00:00:00Z';
  sr.events['newyear-test'] = { end: '2099-01-01T00:00:00Z', cosmetics: [], fighters: [], skins: ['nika_stage_idol'] };
  fs.writeFileSync(path.join(hooksDir, 'lib', 'save_rules.js'), `module.exports = ${JSON.stringify(sr, null, 2)};\n`);
  const shr = JSON.parse(JSON.stringify(SR));
  shr.seasons.season_spooky_broadcast = { event: 'halloween-2026', start: '2026-01-01T00:00:00Z', end: '2099-01-01T00:00:00Z' };
  shr.seasons.skin_nika_stage_idol = { event: 'newyear-test', start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' };
  fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(shr, null, 2)};\n`);
  const SU = { email: 'seasonal-admin@seasonal.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_SESSIONS: 'off', PRIME_SHOP_SALES: 'open' }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
  try {
    const su = (await http('POST', '/api/collections/_superusers/auth-with-password', '', { identity: SU.email, password: SU.pw })).j.token as string;
    const t0 = Date.now();
    const cfg = (await http('GET', '/api/prime/config')).j;
    check('/api/prime/config carries the server\'s clock (`time`, ms)', typeof cfg.time === 'number' && Math.abs(cfg.time - t0) < 5000, String(cfg.time));
    const pw = 'Seasonal' + crypto.randomBytes(6).toString('hex');
    const mk = async (email: string) => {
      const u = (await http('POST', '/api/collections/users/records', su, { email, password: pw, passwordConfirm: pw, verified: true })).j;
      for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
      await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
      const tok = (await http('POST', '/api/collections/users/auth-with-password', '', { identity: email, password: pw })).j.token as string;
      return { id: u.id as string, tok };
    };
    let opN = 0;
    const put = async (who: { tok: string }, data: any, base: number) => {
      const text = canonicalJSON(data);
      return http('PUT', '/api/prime/save', who.tok, { base, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), op: 'seasonalop' + String(++opN).padStart(4, '0'), device: 'seasonal-check', reason: 'sync', client: 'seasonal-check' });
    };
    const A = await mk('a@seasonal.test');
    const B = await mk('b@seasonal.test');
    const C = await mk('c@seasonal.test');
    const base = JSON.parse(JSON.stringify(defaultSave()));
    // first save: no stored copy to compare with → taken (a guest career moved in, a new device)
    const first = await put(A, base, 0);
    check('(set-up) the first cloud save of an account is taken', first.status === 200 && first.j.revision === 1, JSON.stringify(first.j).slice(0, 200));
    const late = JSON.parse(JSON.stringify(base));
    late.cosmetics.owned = ['card_pumpkin'];
    late.events = { 'halloween-2026': { tokens: 0, earned: 120, spent: 120, quests: {}, bought: ['card_pumpkin'], fighters: [], grandClaimed: false, day: '', dayTokens: 0 } };
    const stored = async (uid: string) => (await http('GET', `/api/collections/saves/records?filter=${encodeURIComponent(`owner="${uid}"`)}`, su)).j.items[0];
    const hashBefore = (await stored(A.id)).hash;
    const refused = await put(A, late, 1);
    const after = await stored(A.id);
    check('an exchange cosmetic bought after the season (by the server\'s clock) → 422 season_closed; the stored save is unchanged', refused.status === 422 && refused.j.code === 'season_closed' && refused.j.event === 'halloween-2026' && after.revision === 1 && after.hash === hashBefore, JSON.stringify(refused.j));
    const lateL = JSON.parse(JSON.stringify(base));
    lateL.fighters.lucien.unlocked = true;
    lateL.events = { 'halloween-2026': { tokens: 0, earned: 500, spent: 500, quests: {}, bought: [], fighters: [{ id: 'lucien', at: Date.now() - 86400000 * 400 }], grandClaimed: false, day: '', dayTokens: 0 } };
    check('…a seasonal fighter opened after the season → 422 season_closed (the record\'s own date is the device\'s — not trusted)', (await put(A, lateL, 1)).j.code === 'season_closed');
    const other = JSON.parse(JSON.stringify(base));
    other.money += 500;
    check('…any other progress is taken as before (200)', (await put(A, other, 1)).status === 200);
    // a skin record in a running exchange (the test one) is accepted; in an exchange that does not list it — refused
    const sk = JSON.parse(JSON.stringify(base));
    sk.events = { 'newyear-test': { tokens: 0, earned: 300, spent: 300, quests: {}, bought: [], fighters: [], skins: [{ id: 'nika_stage_idol', at: Date.now() }], grandClaimed: false, day: '', dayTokens: 0 } };
    check('a skin obtained in a running exchange is taken into the cloud (save.events[…].skins)', (await put(B, sk, 0)).status === 200);
    const skBad = JSON.parse(JSON.stringify(base));
    skBad.events = { 'halloween-2026': { tokens: 0, earned: 0, spent: 0, quests: {}, bought: [], fighters: [], skins: [{ id: 'vega_star_pilot', at: Date.now() }], grandClaimed: false, day: '', dayTokens: 0 } };
    check('…a skin record in an exchange that does not list it → refused (400)', (await put(C, skBad, 0)).status === 400);
    // the shop: seasonal_only during the season (any kind), owned when obtained for tokens
    const offer = (await http('GET', '/api/prime/shop/offer')).j.offer;
    if (offer) for (const x of [A, B, C]) await http('POST', '/api/prime/shop/offer/accept', x.tok, { revision: offer.revision, sha256: offer.sha256 });
    const so = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'season_spooky_broadcast' });
    check('a seasonal COSMETIC during its season → 409 seasonal_only (tokens only — the server\'s clock)', so.status === 409 && so.j.code === 'seasonal_only' && so.j.event === 'halloween-2026', JSON.stringify(so.j));
    const skOwned = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'skin_nika_stage_idol' });
    check('a SKIN obtained for tokens (the cloud save\'s exchange record) → 409 owned — never sold to that account', skOwned.status === 409 && skOwned.j.code === 'owned', JSON.stringify(skOwned.j));
    const skFree = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'skin_nika_stage_idol' });
    check('…for an account without it, after its season: the next check — the offer in force (№ 3 / № 4) does not list it → 409 not_in_offer, never sold on an approved price alone', skFree.status === 409 && skFree.j.code === 'not_in_offer', JSON.stringify(skFree.j));
    // 1.9.5: the goods of the terms in force — the eleven approved items are listed (list price), but nothing is charged for them
    const cfg2 = (await http('GET', '/api/prime/config')).j;
    const newSkus = ['skin_nika_stage_idol', 'skin_vega_star_pilot', 'fx_studio_spotlights', 'fx_neon_fireworks', 'fx_glitch_dash', 'fx_comet_trail', 'fx_arcade_frame', 'fx_holo_foil', 'season_halloween_cards', 'season_spooky_broadcast', 'season_pumpkin_victory'];
    check('the public config: the approved list price of each new item, NO charge while the offer in force does not list it (the seven of № 4 unchanged)', newSkus.every((k) => typeof cfg2.shop.prices[k] === 'number' && cfg2.shop.prices[k] > 0 && cfg2.shop.charge[k] === null) && cfg2.shop.prices.skin_nika_stage_idol === 14900 && cfg2.shop.prices.fx_glitch_dash === 5900, JSON.stringify(cfg2.shop.charge));
    const gated = await Promise.all(['fx_glitch_dash', 'skin_vega_star_pilot', 'fx_holo_foil'].map((s) => http('POST', '/api/prime/shop/checkout', A.tok, { sku: s })));
    check('…a checkout of any of them → 409 not_in_offer (no quote, no order)', gated.every((r) => r.status === 409 && r.j.code === 'not_in_offer' && !r.j.quote), gated.map((r) => r.j.code).join());
    check('no order was created by any of these requests', (await http('GET', '/api/collections/shop_orders/records?perPage=1', su)).j.totalItems === 0);
    // …and once a revision listing them is in force (a TEST revision 5, its day passed): the sale goes on to its next check
    await stopChild(pb);
    pb = null;
    const R5 = { revision: 5, title: 'Тестовая оферта № 5', url: 'https://primetimeshowdown.online/legal/ru/offer-test-r5.html', effectiveFrom: '2026-01-03', sha256: crypto.createHash('sha256').update('seasonal-check offer 5').digest('hex'), minors: true, fighters: true, minorLimits: { orderMaxRub: 500, per30DaysRub: 2000, characters: true }, items: GOODS_R5 };
    const shr5 = JSON.parse(JSON.stringify(shr));
    shr5.offers = [...shr5.offers.filter((o: any) => o.revision < 5), R5];
    fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(shr5, null, 2)};\n`);
    pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_SESSIONS: 'off', PRIME_SHOP_SALES: 'open' }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
    pb.stdout.on('data', keep);
    pb.stderr.on('data', keep);
    if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not restart');
    const cfg5 = (await http('GET', '/api/prime/config')).j;
    const g5 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_glitch_dash' });
    // 1.9.5: an exact moment, as the server reads it — a revision in force since a minute ago (ISO with time) is the one
    // offered; one that starts in an hour is not yet
    const now5 = Date.now();
    const shrT = JSON.parse(JSON.stringify(shr5));
    shrT.offers = [...shrT.offers.filter((o: any) => o.revision < 5), { ...R5, effectiveFrom: new Date(now5 - 60000).toISOString() }, { ...R5, revision: 6, sha256: 'c'.repeat(64), effectiveFrom: new Date(now5 + 3600000).toISOString() }];
    check('under a revision that lists them (test № 5 in force): charged at the approved price (GLITCH DASH 59 ₽), the checkout goes on to the consent with that revision', cfg5.shop.charge.fx_glitch_dash === 5900 && g5.status === 409 && g5.j.code === 'offer_consent_required' && g5.j.quote?.priceKop === 5900 && g5.j.offer?.revision === 5, JSON.stringify(g5.j).slice(0, 300));
    await stopChild(pb);
    pb = null;
    fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(shrT, null, 2)};\n`);
    pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_SESSIONS: 'off', PRIME_SHOP_SALES: 'open' }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
    pb.stdout.on('data', keep);
    pb.stderr.on('data', keep);
    if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not restart');
    const offT = (await http('GET', '/api/prime/shop/offer')).j.offer;
    const gT = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_comet_trail' });
    check('the server, exact moments (ISO with time): the revision in force since a minute ago is offered (№ 5), the one starting in an hour is not (№ 6); its goods are sold', offT?.revision === 5 && gT.j.code === 'offer_consent_required' && gT.j.offer?.revision === 5 && gT.j.quote?.priceKop === 5900, JSON.stringify(offT) + ' ' + JSON.stringify(gT.j).slice(0, 200));
  } finally {
    await stopChild(pb);
    pb = null;
  }
}

async function main(): Promise<void> {
  ruleChecks();
  guardChecks();
  momentChecks();
  effectChecks();
  try {
    await serverChecks();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nseasonal: ${failed === 0 ? 'OK' : 'FAILED'} (${passed} passed, ${failed} failed) — временная база удалена`);
  if (failed) proc.exitCode = 1;
}

void main();
