// Alpha 1.8.8 stage 4 — the game's side of PRIME PAYMENTS, for `npm run payments`: the order model, the way
// back from Robokassa, the payment page allow-list, rights that follow the signed-in PRIME ID only, the paid
// LUCIEN in the roster, and that a forged save or a forged return address opens nothing.

import { SHOP_ITEMS, SHOP_PRICES_RUB, SHOP_SALES_OPEN, SKU_OF_FIGHTER, receiptNameOf, rubToKop } from '../../src/config/shop.config';
import { EventManager } from '../../src/meta/EventManager';
import { entitlementsKnown, ownsPaid, setEntitlements } from '../../src/meta/entitlements';
import {
  PAYMENT_GATEWAY,
  PAY_RETURN_KEY,
  PAY_RETURN_TTL_MS,
  POLL_DELAYS_MS,
  TEST_PAY_BAND,
  checkPaymentPage,
  isTestPay,
  keepChecking,
  loadReturn,
  mergeReturn,
  onOrderSignal,
  orderOf,
  orderPhase,
  readReturnQuery,
  saveReturn,
  signalOrder,
  stripReturnQuery,
  type ServerOrder,
} from '../../src/meta/Payments';
import { inRoster, inRosterByPurchase } from '../../src/meta/roster';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../../src/meta/SaveSystem';
import { Shop } from '../../src/meta/Shop';
import { ROOT } from './backendKit';
import { fs, path } from './node';

type Check = (name: string, ok: boolean, detail?: string) => void;
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;
const code = (s: string) => s.replace(/^\s*(\/\/|\*).*$/gm, '');

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

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
}

function world(at: string, data?: SaveData) {
  const store = new MemSave();
  if (data) store.data = data;
  const now = Date.parse(at);
  const events = new EventManager(store as unknown as SaveSystem, { clock: () => now });
  const shop = new Shop(store as unknown as SaveSystem, events, events.collection);
  return { store, events, shop };
}

const order = (o: Partial<ServerOrder> = {}): ServerOrder => ({ inv: 900000001, sku: 'skin_ray_neon_runner', title: 'RAY: NEON RUNNER', amountKop: 1000, currency: 'RUB', status: 'pending_payment', env: 'test', created: '', expiresAt: 0, paidAt: 0, fulfilledAt: 0, ...o });

export async function clientChecks(check: Check, section: (t: string) => void): Promise<void> {
  section('Клиент: модель заказа, путь назад с Robokassa, права PRIME ID');
  // ------------------------------------------------------------------ the payment page
  const good = { url: PAYMENT_GATEWAY, method: 'POST', fields: { MerchantLogin: 'primetimeshowdown', OutSum: '10.00', InvId: '900000001', Description: 'x', SignatureValue: 'ab', IsTest: '1', Culture: 'ru', Shp_order: 'o1', ExpirationDate: '2026-10-23T15:00' } };
  check('payment page: Robokassa\'s official page with its own fields is accepted', checkPaymentPage(good)?.url === 'https://auth.robokassa.ru/Merchant/Index.aspx');
  const refused = [
    { ...good, url: 'https://auth.robokassa.ru.evil.example/Merchant/Index.aspx' },
    { ...good, url: 'http://auth.robokassa.ru/Merchant/Index.aspx' },
    { ...good, url: 'https://evil.example/pay' },
    { ...good, url: 'http://127.0.0.1:19192/pay' },
    { ...good, method: 'GET' },
    { ...good, fields: { ...good.fields, Password1: 'x' } },
    { ...good, fields: { ...good.fields, OutSum: 10 } },
    { ...good, fields: { ...good.fields, SignatureValue: '' } },
    null,
  ];
  check('payment page: any other host, plain http, the local emulator (production), GET, extra fields, non-strings, a missing signature → refused', refused.every((p) => checkPaymentPage(p, false) === null));
  check('the local emulator on 127.0.0.1 is accepted only in a development build (the caller passes import.meta.env.DEV)', checkPaymentPage({ ...good, url: 'http://127.0.0.1:19192/pay' }, true) !== null && /checkPaymentPage\(start\.payment, import\.meta\.env\.DEV\)/.test(read('src/ui/checkoutUI.ts')));
  // ------------------------------------------------------------------ orders
  check('a server order is read strictly (unknown status / env / no number → nothing)', orderOf(order()) !== null && orderOf({ ...order(), status: 'paid_by_client' }) === null && orderOf({ ...order(), env: 'prod' }) === null && orderOf({ ...order(), inv: 0 }) === null && orderOf('x') === null);
  const ph = (o: Partial<ServerOrder>, owned: string[] = [], back = false) => orderPhase(order(o), owned, back);
  check('«done» (the success screen) only when the order is fulfilled AND the item is in the server\'s list of rights', ph({ status: 'fulfilled' }, ['skin_ray_neon_runner']) === 'done' && ph({ status: 'fulfilled' }, []) === 'delivering' && ph({ status: 'paid' }, ['skin_ray_neon_runner']) === 'delivering');
  check('not paid: «checking» right after a SuccessURL return, «unpaid» otherwise (a FailURL return, an older order)', ph({}, [], true) === 'checking' && ph({}, [], false) === 'unpaid');
  check('closed / review / refund phases; only checking and delivering are asked again', ph({ status: 'expired' }) === 'closed' && ph({ status: 'failed' }) === 'closed' && ph({ status: 'canceled' }) === 'closed' && ph({ status: 'requires_review' }) === 'review' && ph({ status: 'refunded' }) === 'refund' && keepChecking('checking') && keepChecking('delivering') && !keepChecking('unpaid') && !keepChecking('done'));
  const total = POLL_DELAYS_MS.reduce((a, b) => a + b, 0);
  check(`checking after the return is bounded: ${POLL_DELAYS_MS.length} requests over ${Math.round(total / 1000)} s, then «загляните позже» (never endless)`, POLL_DELAYS_MS.length <= 10 && total <= 60000 && /if \(this\.pollStep < POLL_DELAYS_MS\.length\)[^\n]*\n\s*else this\.slow = true;/.test(read('src/ui/checkoutUI.ts')));
  // ------------------------------------------------------------------ the way back
  const q = readReturnQuery('?prime_pay=success&inv=900000001&x=1');
  check('the return address ?prime_pay=success|fail&inv=N is read; anything else ignored', q?.result === 'success' && q.inv === 900000001 && readReturnQuery('?prime_pay=paid&inv=1') === null && readReturnQuery('?prime_pay=fail&inv=abc')?.inv === null && readReturnQuery('') === null);
  check('…and removed from the address (other parameters kept), so a reload does not repeat it', stripReturnQuery('https://primetimeshowdown.online/?x=1&prime_pay=success&inv=5#h') === '/?x=1#h' && stripReturnQuery('https://primetimeshowdown.online/?prime_pay=fail&inv=5') === '/');
  const st = new MemStore();
  const now = Date.parse('2026-11-10T12:00:00Z');
  saveReturn(st, { inv: 900000001, sku: 'skin_ray_neon_runner', account: 'acc_a', at: now, result: 'left' });
  const raw = st.getItem(PAY_RETURN_KEY) ?? '';
  check('the note before leaving holds the order number, the item, the account, the time — no price, signature, token or ownership', Object.keys(JSON.parse(raw)).sort().join() === 'account,at,inv,result,sku,v' && !/Signature|token|price|owned|OutSum/i.test(raw));
  const back = mergeReturn(loadReturn(st, now + 60000), readReturnQuery('?prime_pay=success&inv=900000001'), now + 60000);
  check('back through SuccessURL: the same order, now «success»', back?.inv === 900000001 && back.result === 'success' && back.sku === 'skin_ray_neon_runner');
  check('another order number in the address than the one this tab left for → followed as that number only (the server shows an order only to its owner)', mergeReturn(loadReturn(st, now), { result: 'success', inv: 900000077 }, now)?.sku === null);
  check('no note (another tab) → the number alone, the item comes from the server\'s order', mergeReturn(null, { result: 'fail', inv: 900000005 }, now)?.inv === 900000005 && mergeReturn(null, { result: 'fail', inv: null }, now) === null);
  check(`the note runs out after ${PAY_RETURN_TTL_MS / 3600000} h; a broken or foreign note is dropped`, loadReturn(st, now + PAY_RETURN_TTL_MS + 1) === null && st.getItem(PAY_RETURN_KEY) === null && (st.setItem(PAY_RETURN_KEY, '{"v":1,"inv":-3}'), loadReturn(st, now) === null));
  const game = read('src/game/Game.ts');
  const note = game.slice(game.indexOf('private notePayReturn'), game.indexOf('// ------------------------------------------------------------ navigation', game.indexOf('private notePayReturn')));
  check('a forged SuccessURL return opens nothing: the game only notes which order to check (no rights, no save, no success screen)', note.length > 100 && !/setEntitlements|applyRights|\.save\(\)|devGrant|celebrat/.test(code(note)));

  // ------------------------------------------------------------------ rights follow the PRIME ID
  section('Клиент: права на покупки, платный Люсьен, подделки');
  setEntitlements([], false);
  check('before the server answered nothing paid is owned (and the list says it is not known yet)', !ownsPaid('skin_ray_neon_runner') && !entitlementsKnown());
  setEntitlements(['skin_ray_neon_runner', 'fighter_lucien']);
  const w = world('2026-11-10T12:00:00Z');
  const ray = SHOP_ITEMS.find((i) => i.sku === 'skin_ray_neon_runner')!;
  const lucien = SHOP_ITEMS.find((i) => i.sku === 'fighter_lucien')!;
  check('the server\'s list → the shop says «Приобретено», the skin can be worn, LUCIEN is in the roster', w.shop.state(ray).price === 'Приобретено' && w.shop.setSkin('ray', 'ray_neon_runner') && w.shop.lookFor('ray') === 'ray_neon_runner' && inRoster(w.store.data, 'lucien') && w.events.ownsFighter('lucien') && w.shop.state(lucien).status === 'received');
  check('the paid LUCIEN is NOT written into the save (fighters.lucien.unlocked stays false) — only the wear choice is saved', w.store.data.fighters.lucien.unlocked === false && inRosterByPurchase(w.store.data, 'lucien') && SKU_OF_FIGHTER.lucien === 'fighter_lucien');
  setEntitlements([]);
  check('signing out / another PRIME ID: the list is emptied → the skin is not worn any more (the choice stays), LUCIEN leaves the roster', !ownsPaid('skin_ray_neon_runner') && w.shop.lookFor('ray') !== 'ray_neon_runner' && !inRoster(w.store.data, 'lucien') && entitlementsKnown());
  const rt = read('src/game/AccountRuntime.ts');
  check('AccountRuntime: another (or no) account → the list is emptied AT ONCE, before the new one is read; never kept on the device', /if \(changed\) \{\s*this\.rightsOwner = owner;\s*this\.rightsSeq\+\+;[\s\S]{0,200}setEntitlements\(\[\], owner === null\);/.test(rt) && !/localStorage|sessionStorage|writeSync\([^)]*entitle/.test(rt.slice(rt.indexOf('refreshRights('), rt.indexOf('private afterRights'))));
  check('…a late answer for the previous account is thrown away (sequence and owner checked); another account\'s career never uses these rights', /if \(seq !== this\.rightsSeq \|\| this\.rightsOwner !== owner\) return;/.test(rt) && /return !playing \|\| playing === uid \? uid : null;/.test(rt));
  // LUCIEN opened for tokens is independent of any purchase
  const tok = defaultSave();
  tok.fighters.lucien.unlocked = true;
  const wt = world('2026-11-10T12:00:00Z', tok);
  setEntitlements([]);
  check('LUCIEN opened for PUMPKIN TOKENS stays whatever the purchase list says (a refund never touches him)', inRoster(wt.store.data, 'lucien') && !inRosterByPurchase(wt.store.data, 'lucien'));
  // forged saves
  const forged = JSON.parse(JSON.stringify(defaultSave()));
  forged.shop = { skins: { ray: 'ray_neon_runner' }, equip: { dash: 'dash_prime_phantom' } };
  forged.cosmetics = { ...(forged.cosmetics ?? {}), owned: [...(forged.cosmetics?.owned ?? []), 'dash_prime_phantom', 'victory_golden_confetti'] };
  forged.fighters.lucien.unlocked = false;
  forged.selected = 'lucien';
  const wf = world('2026-11-10T12:00:00Z', sanitize(forged));
  check('a forged save (skin chosen, PRIME SHOP items listed as owned, LUCIEN selected) opens nothing', !wf.shop.ownsSkin('ray_neon_runner') && wf.shop.lookFor('ray') === 'ray' && !wf.events.collection.owns('dash_prime_phantom') && !wf.events.collection.owns('victory_golden_confetti') && !inRoster(wf.store.data, 'lucien'));
  check('the save keeps a seasonal star selected (a purchase is not in the save) but the game plays Ray while it is not confirmed', sanitize(forged).selected === 'lucien' && /const fighter = inRoster\(s, s\.selected\) \? s\.selected : 'ray';/.test(game));
  const locked = JSON.parse(JSON.stringify(defaultSave()));
  locked.selected = 'vega';
  check('a non-seasonal fighter that is not signed is never kept selected (as before)', sanitize(locked).selected === 'ray');
  check('a refunded / unconfirmed paid fighter is unselected only once the server answered (Ray), never on a guess', /if \(!entitlementsKnown\(\) \|\| !this\.g\.save\.writable \|\| inRoster\(s, s\.selected\)\) return;\s*this\.g\.career\.select\('ray'\);/.test(rt));

  // ------------------------------------------------------------------ the window
  const ui = read('src/ui/checkoutUI.ts');
  const ord = read('src/ui/checkoutOrder.ts');
  check('the purchase window never grants, wears or saves (no setEntitlements / devGrant / setSkin / setEquipped / save())', [ui, ord, read('src/ui/checkoutPreview.ts'), read('src/meta/Payments.ts')].every((s) => !/setEntitlements\(|devGrant\(|\.grant\(|setSkin\(|setEquipped\(|\.save\(\)/.test(code(s))));
  check('«ПОКУПКА ПОДТВЕРЖДЕНА» is drawn only for phase «done» (fulfilled + in the server\'s rights) without an issue', /if \(v\.phase === 'done' && !v\.issue && !v\.leaving\) return winHTML\(g, v\);/.test(ord) && (ord.match(/Покупка подтверждена/g) ?? []).length === 3);
  check('the purchase leaves only through a form to the checked page; the request still carries only the sku', /const page: PaymentPage \| null = checkPaymentPage\(/.test(ui) && /form\.action = page\.url;/.test(ui) && /\/api\/prime\/shop\/checkout', \{ \.\.\.o, method: 'POST', body: \{ sku \} \}/.test(read('src/net/PrimeApi.ts')));
  check('a page that does not open → «Страница оплаты не открылась» with «Повторить оплату» (the SAME order, no second payment)', /this\.orderIssue = 'leave_failed';/.test(ui) && /Страница оплаты не открылась/.test(ord) && /void this\.pay\(true\)/.test(ui));
  check('support: the official contact with the order number, never a made-up address', /primetimeshowdown\.official@gmail\.com/.test(read('src/meta/Payments.ts')) && /SUPPORT_EMAIL/.test(ord) && !/@(?!gmail\.com)[a-z0-9-]+\.(ru|com|net)/i.test(ord.replace(/primetimeshowdown\.official@gmail\.com/g, '')));
  check('a test payment is labelled everywhere (band, status, price, terms, success): «ТЕСТОВАЯ ПОКУПКА — НАСТОЯЩИЕ ДЕНЬГИ НЕ СПИСЫВАЮТСЯ»', TEST_PAY_BAND === 'ТЕСТОВАЯ ПОКУПКА — НАСТОЯЩИЕ ДЕНЬГИ НЕ СПИСЫВАЮТСЯ' && /\$\{TEST_PAY_BAND\}/.test(ui) && /\$\{TEST_PAY_BAND\}/.test(ord) && /Тестовый платёж/.test(ui) && /деньги не списываются/.test(ui) && /Я понимаю, что это тестовая оплата Robokassa/.test(ui) && /Я понимаю, что это демонстрационная оплата Robokassa/.test(ui) && /Тестовая покупка подтверждена/.test(ord));
  check('every test-mode branch of the game covers the demonstration too (isTestPay: test | demo); an unknown mode reads as live', isTestPay('test') && isTestPay('demo') && !isTestPay('live') && !isTestPay(null) && !/env === 'test'/.test(code(ui) + code(ord)) && /v === 'test' \|\| v === 'demo' \? v : 'live'/.test(read('src/net/PrimeApi.ts')));
  check('a demonstration order is read (env demo); anything else unknown is refused', orderOf({ ...order(), env: 'demo' })?.env === 'demo' && orderOf({ ...order(), env: 'sandbox' }) === null);

  // ------------------------------------------------------------------ 1.8.8: prices from the server, tabs, return
  section('Клиент: цены и продажи — только со слов сервера; вторая вкладка; возврат с оплаты');
  const ws = world('2026-10-23T12:00:00Z');
  const rayItem = SHOP_ITEMS.find((i) => i.sku === 'skin_ray_neon_runner')!;
  ws.shop.setServer(null);
  const s0 = ws.shop.state(rayItem);
  const lucienItem = SHOP_ITEMS.find((i) => i.sku === 'fighter_lucien')!;
  check('no word from the server → the APPROVED price of this release (RAY 99 ₽), not for sale, «ПОКА НЕ В ПРОДАЖЕ»; LUCIEN (only proposed) has no price', ws.shop.priceKop('skin_ray_neon_runner') === 9900 && s0.price === '99 ₽' && !ws.shop.selling('skin_ray_neon_runner') && s0.status === 'soon' && s0.chip === 'ПОКА НЕ В ПРОДАЖЕ' && ws.shop.priceNote() === 'Продажи не открыты' && ws.shop.priceKop('fighter_lucien') === null && ws.shop.testPayLine('skin_ray_neon_runner') === null);
  const official = Object.fromEntries(Object.keys(SHOP_PRICES_RUB).map((k) => [k, k === 'fighter_lucien' ? null : rubToKop(SHOP_PRICES_RUB[k as keyof typeof SHOP_PRICES_RUB])]));
  const tenRub = Object.fromEntries(Object.keys(SHOP_PRICES_RUB).map((k) => [k, 1000]));
  ws.shop.setServer({ selling: true, env: 'test', pricesKop: official, chargeKop: tenRub });
  const s1 = ws.shop.state(rayItem);
  check('a staging server (TEST payments of 10 ₽): the item keeps its REAL price (99 ₽); «Тестовая оплата 10 ₽ · деньги не списываются» beside it; chip «ТЕСТ-ОПЛАТА»', ws.shop.priceKop('skin_ray_neon_runner') === 9900 && s1.price === '99 ₽' && ws.shop.testPayLine('skin_ray_neon_runner') === 'Тестовая оплата 10 ₽ · деньги не списываются' && ws.shop.selling('skin_ray_neon_runner') && s1.status === 'on_sale' && s1.chip === 'ТЕСТ-ОПЛАТА' && ws.shop.priceNote() === 'Тестовая оплата · без списаний');
  ws.shop.setServer({ selling: true, env: 'demo', pricesKop: official, chargeKop: { ...official, fighter_lucien: null }, demoUntil: '2026-11-30' });
  const s2 = ws.shop.state(rayItem);
  check('the official site\'s demonstration: the real price 99 ₽ IS the test payment (no money moves) — «ДЕМО-ОПЛАТА», the demo note; LUCIEN is never on demonstration sale', s2.price === '99 ₽' && s2.chip === 'ДЕМО-ОПЛАТА' && ws.shop.testPayLine('skin_ray_neon_runner') === 'Тестовая оплата Robokassa · деньги не списываются' && /настоящие деньги не списываются/.test(s2.note) && ws.shop.priceNote() === 'Демо-оплата · деньги не списываются' && !ws.shop.selling('fighter_lucien') && ws.shop.state(lucienItem).status !== 'on_sale');
  ws.shop.setServer({ selling: false, env: 'test', pricesKop: official, chargeKop: tenRub });
  check('…the same server with sales closed → not for sale (the price may show, nothing promised)', !ws.shop.selling('skin_ray_neon_runner') && ws.shop.state(rayItem).chip === 'ПОКА НЕ В ПРОДАЖЕ' && ws.shop.testPayLine('skin_ray_neon_runner') === null);
  ws.shop.setServer({ selling: true, env: 'live', pricesKop: official, chargeKop: official });
  check(`a live server's price is the one shown (99 ₽, no test line); a live sale also needs this release to open sales (SHOP_SALES_OPEN = ${SHOP_SALES_OPEN})`, ws.shop.priceOf('skin_ray_neon_runner') === '99 ₽' && ws.shop.testPayLine('skin_ray_neon_runner') === null && ws.shop.selling('skin_ray_neon_runner') === SHOP_SALES_OPEN && ws.shop.priceNote() === (SHOP_SALES_OPEN ? 'Цены в рублях' : 'Продажи не открыты'));
  ws.shop.setServer({ selling: true, env: 'test', pricesKop: { ...official, fx_phantom_dash: null }, chargeKop: { ...tenRub, fx_phantom_dash: null } });
  check('an item without a server price or amount → «Цена уточняется», never buyable', ws.shop.priceOf('fx_phantom_dash') === 'Цена уточняется' && !ws.shop.selling('fx_phantom_dash'));
  const promise = /(^|[^а-яё])(скоро|в ближайшее время)([^а-яё]|$)/i;
  const promiseIn = ['src/meta/Shop.ts', 'src/ui/screens/ShopScreen.ts', 'src/ui/checkoutUI.ts', 'src/ui/checkoutOrder.ts'].filter((f) => promise.test(code(read(f)).replace(/\/\/.*$/gm, '')));
  check('no sale is promised anywhere in PRIME SHOP / PRIME CHECKOUT while sales are closed («скоро», «в ближайшее время»)', promiseIn.length === 0, promiseIn.join());
  const receiptWord = /(^|[^а-яё])чек(а|и|ом|у)?([^а-яё]|$)/i;
  const receiptIn = ['src/meta/Shop.ts', 'src/ui/screens/ShopScreen.ts', 'src/ui/checkoutUI.ts', 'src/ui/checkoutOrder.ts', 'src/meta/Payments.ts'].filter((f) => receiptWord.test(code(read(f)).replace(/\/\/.*$/gm, '')));
  check('no fiscal receipt is claimed in the game («чек …»): the server never learns that a receipt was made, so the game never says so', receiptIn.length === 0, receiptIn.join());
  const names = SHOP_ITEMS.map((i) => receiptNameOf(i));
  check('receipt / payment names: «Цифровой облик бойца … / Цифровой предмет оформления … / Открытие игрового персонажа …» — the item named, ≤ 100 characters, no characters Robokassa strips', names.every((n) => n.length <= 100 && /PRIME TIME: SHOWDOWN$/.test(n) && !/[«»"'<>&]/.test(n)) && /^Цифровой облик бойца RAY: NEON RUNNER /.test(receiptNameOf(rayItem)) && /^Открытие игрового персонажа /.test(receiptNameOf(SHOP_ITEMS.find((i) => i.sku === 'fighter_lucien')!)), names.join(' | '));
  // the other tab: a signal only says «look at order N again» — the tab asks the server itself
  const got: number[] = [];
  const stop = onOrderSignal((inv) => got.push(inv));
  signalOrder(900000123);
  const raw2 = new BroadcastChannel('primetime-showdown-pay');
  raw2.postMessage({ inv: 'x' });
  raw2.postMessage({ inv: 900000124, status: 'fulfilled', owned: ['skin_ray_neon_runner'] });
  await new Promise((r) => setTimeout(r, 80));
  stop();
  signalOrder(900000125);
  await new Promise((r) => setTimeout(r, 80));
  raw2.close();
  check('cross-tab signal: the order number reaches the other tab (BroadcastChannel); garbage is ignored; nothing but the number is taken; stops on demand', got.join() === '900000123,900000124', got.join());
  const ui2 = read('src/ui/checkoutUI.ts');
  const newTab = ui2.slice(ui2.indexOf('private openPaymentNewTab'), ui2.indexOf('// ---------------------------------------------------------------- following an order'));
  check('«Открыть в новой вкладке»: the SAME signed page (no new order) sent inside the tap (no await), target _blank without an opener', /form\.target = '_blank';/.test(ui2) && /form\.rel = 'noopener'/.test(ui2) && /const page = this\.lastPayment;/.test(newTab) && /this\.paymentForm\(page, true\)/.test(newTab) && !/await|fetch|api\./.test(code(newTab)));
  check('the waiting tab checks the order again when the player looks at it (visibilitychange / focus) and when another tab signals; listeners removed on close', /document\.addEventListener\('visibilitychange', this\.onVisible\)/.test(ui2) && /document\.removeEventListener\('visibilitychange', this\.onVisible\)/.test(ui2) && /window\.addEventListener\('focus', this\.onVisible\)/.test(ui2) && /onOrderSignal\(\(inv\) => \{\s*if \(inv === this\.orderInv\) this\.recheckSoon\(\);/.test(ui2) && /signalOrder\(inv\);/.test(ui2));
  check('back on the title screen after paying: «PRIME SHOP · заказ №N: нажмите, чтобы проверить покупку» — a note only, the server decides', /PRIME SHOP · заказ №\$\{payNote\.inv\}: нажмите, чтобы проверить покупку/.test(read('src/game/Game.ts')) && /setNote\(text: string\)/.test(read('src/ui/screens/TitleScreen.ts')));
}
