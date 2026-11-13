// Alpha 1.9.7 — `npm run metrika`: the consent logic of public/metrika.js (Yandex Metrika 114123351), run as is in an
// isolated context with a small fake browser (document, storage, cookies). Nothing is loaded from Yandex: the check only
// sees whether the counter's script tag would be added and what the counter would be told.

import { fs, path, proc } from './lib/node';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vm: any = (proc as any).getBuiltinModule('node:vm');
import { ROOT } from './lib/backendKit';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
};

const SHIPPED = fs.readFileSync(path.join(ROOT, 'public', 'metrika.js'), 'utf8') as string;
const ON = SHIPPED.replace('var ENABLED = false;', 'var ENABLED = true;');

class El {
  id = '';
  className = '';
  textContent = '';
  href = '';
  src = '';
  async = false;
  target = '';
  rel = '';
  type = '';
  disabled = false;
  children: El[] = [];
  parent: El | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  appendChild(c: El) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  addEventListener(t: string, f: (e: unknown) => void) {
    (this.listeners[t] ??= []).push(f);
  }
  click() {
    for (const f of this.listeners.click ?? []) f({ stopPropagation() {} });
  }
  all(): El[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

interface World {
  ctx: Record<string, any>;
  head: El;
  body: El;
  store: Map<string, string>;
  jar: Map<string, string>;
  root: El;
}

function world(src: string, o: { host?: string; search?: string; store?: Record<string, string>; cookies?: Record<string, string>; page?: string; lang?: string } = {}): World {
  const store = new Map(Object.entries(o.store ?? {}));
  const jar = new Map(Object.entries(o.cookies ?? {}));
  const root = new El('html');
  if (o.page) root.setAttribute('data-pt-page', o.page);
  if (o.lang) root.setAttribute('lang', o.lang);
  const head = root.appendChild(new El('head'));
  const body = root.appendChild(new El('body'));
  if (o.page) body.appendChild(Object.assign(new El('div'), { id: 'pt-analytics-controls' }));
  const host = o.host ?? 'primetimeshowdown.online';
  const search = o.search ?? '';
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const document = {
    readyState: 'complete',
    referrer: '',
    documentElement: root,
    head,
    body,
    createElement: (t: string) => new El(t),
    createTextNode: (s: string) => Object.assign(new El('#text'), { textContent: s }),
    getElementById: (id: string) => root.all().find((e) => e.id === id) ?? null,
    addEventListener() {},
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(s: string) {
      const [kv] = s.split(';');
      const [k, v] = kv.split('=');
      if (/expires=Thu, 01 Jan 1970/.test(s)) jar.delete(k.trim());
      else jar.set(k.trim(), v ?? '');
    },
  };
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const ctx: Record<string, any> = {
    document,
    navigator: { language: 'ru-RU' },
    location: { hostname: host, href: `https://${host}/${search}`, search },
    URL,
    URLSearchParams,
    JSON,
    Date,
    Number,
    Math,
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f),
    dispatch: (t: string, e: unknown) => (listeners[t] ?? []).forEach((f) => f(e)),
  };
  ctx.window = ctx;
  ctx.localStorage = localStorage;
  vm.runInNewContext(src, ctx);
  return { ctx, head, body, store, jar, root };
}

const tag = (w: World) => w.head.all().find((e) => e.tag === 'script' && /mc\.yandex\.ru\/metrika\/tag\.js\?id=114123351/.test(e.src)) ?? null;
const banner = (w: World) => w.body.all().find((e) => e.id === 'pt-consent') ?? null;
const button = (w: World, label: string) => banner(w)?.all().find((e) => e.tag === 'button' && e.textContent === label) ?? null;
const choiceOf = (w: World) => JSON.parse(w.store.get('primetime-showdown-analytics-v1') ?? 'null')?.c ?? null;
const initArgs = (w: World) => (w.ctx.ym?.a ?? []).map((a: ArrayLike<unknown>) => Array.from(a)).find((a: unknown[]) => a[1] === 'init')?.[2] ?? null;

// the release as shipped: switched off
{
  const w = world(SHIPPED);
  const on = /var ENABLED = true;/.test(SHIPPED);
  // before the owner's approval (Р-28) the release ships it off; legal:release --approved switches it on with its documents
  if (!on) check('shipped with ENABLED = false: no banner, no counter, no cookie, the Settings API says «off»', !banner(w) && !tag(w) && w.jar.size === 0 && w.ctx.PrimeAnalytics.enabled === false && w.ctx.PrimeAnalytics.allow() === false);
  else check('switched on by legal:release --approved: the consent page and privacy v6 are installed with it (RU and EN); still nothing before an answer', fs.existsSync(path.join(ROOT, 'public/legal/ru/analytics.html')) && fs.existsSync(path.join(ROOT, 'public/legal/en/analytics.html')) && /data-version="6"/.test(fs.readFileSync(path.join(ROOT, 'public/legal/ru/privacy.html'), 'utf8')) && !tag(w) && !!banner(w));
}
// switched on (what legal:release --approved does)
{
  const w = world(ON);
  const b = banner(w);
  const txt = b?.all().map((e) => e.textContent).join(' ') ?? '';
  check('switched on, a first visit: the consent notice with the owner\'s text and two equal answers — and NOTHING loaded before an answer', !!b && /Помогите сделать PRIME TIME: SHOWDOWN лучше!/.test(txt) && /используем Яндекс\.Метрику/.test(txt) && /никак не повлияет на игру/.test(txt) && /Изменить решение можно в настройках/.test(txt) && !!button(w, 'Разрешить') && !!button(w, 'Не разрешать') && !tag(w) && !w.ctx.ym && w.jar.size === 0);
  check('…the notice links the consent page and says a parent decides for a child under 14', !!b?.all().find((e) => e.tag === 'a' && /\/legal\/ru\/analytics\.html$/.test(e.href)) && /меньше 14 лет/.test(txt));
  button(w, 'Не разрешать')!.click();
  check('«Не разрешать»: the choice is kept, the notice closes, no counter at all', choiceOf(w) === 'denied' && !banner(w) && !tag(w));
  const w2 = world(ON, { store: { 'primetime-showdown-analytics-v1': JSON.stringify({ v: 1, c: 'denied', at: '' }) } });
  check('…a later visit after a refusal: no notice, no counter', !banner(w2) && !tag(w2));
}
{
  const w = world(ON);
  button(w, 'Разрешить')!.click();
  const init = initArgs(w);
  check('«Разрешить»: the counter 114123351 loads (tag.js) and is told: Webvisor, click map, link and hash tracking OFF', choiceOf(w) === 'granted' && !!tag(w) && !!init && init.webvisor === false && init.clickmap === false && init.trackLinks === false && init.trackHash === false, JSON.stringify(init));
  const calls = (w.ctx.ym?.a ?? []).map((a: ArrayLike<unknown>) => Array.from(a)[1]);
  check('…and nothing else: no user ID, no parameters, no e-commerce', calls.every((c: unknown) => c === 'init') && !/setUserID|userParams|'params'/.test(SHIPPED.replace(/^\s*(\/\/|\*).*$/gm, '')));
  const w2 = world(ON, { store: { 'primetime-showdown-analytics-v1': JSON.stringify({ v: 1, c: 'granted', at: '' }) } });
  check('…a later visit with the consent kept: the counter starts without a notice', !banner(w2) && !!tag(w2));
}
{
  const granted = { 'primetime-showdown-analytics-v1': JSON.stringify({ v: 1, c: 'granted', at: '' }) };
  const pay = world(ON, { store: granted, search: '?prime_pay=success&inv=12' });
  const tok = world(ON, { store: granted, search: '?token=abc&utm_source=x' });
  const ads = world(ON, { store: granted, search: '?utm_source=vk&yclid=5' });
  check('no sensitive address reaches Metrika: with the payment return (?prime_pay&inv) or any other parameter the counter does not start; advertising labels alone are fine', !tag(pay) && !tag(tok) && !!tag(ads));
  const kid = world(ON, { store: { ...granted, 'primetime-showdown-agegate-v1': String(Date.now() + 3600000), _ym_retryReqs: '1' }, cookies: { _ym_uid: '1', _ym_d: '2', other: 'x' } });
  check('an «under 14» answer at the PRIME ID age question: no counter, no notice, and Metrika\'s cookies and storage are removed', !tag(kid) && !banner(kid) && !kid.jar.has('_ym_uid') && !kid.jar.has('_ym_d') && kid.jar.has('other') && !kid.store.has('_ym_retryReqs'));
  const local = world(ON, { host: 'localhost' });
  check('another host (a local copy, a mirror): nothing at all', !banner(local) && !tag(local));
}
{
  // withdrawal from Settings (the game's toggle uses window.PrimeAnalytics)
  const w = world(ON, { store: { 'primetime-showdown-analytics-v1': JSON.stringify({ v: 1, c: 'granted', at: '' }), _ym114123351_lsid: 'x' }, cookies: { _ym_uid: '1', _ym_isad: '2' } });
  const running = w.ctx.PrimeAnalytics.running();
  w.ctx.PrimeAnalytics.decline();
  check('Settings → «Аналитика посещений» off: the refusal is kept, Metrika\'s cookies and storage go, the running counter is told to stop (a reload ends it)', running === true && choiceOf(w) === 'denied' && w.jar.size === 0 && !w.store.has('_ym114123351_lsid') && w.ctx['disableYaCounter114123351'] === true);
  const w3 = world(ON, { store: { 'primetime-showdown-analytics-v1': JSON.stringify({ v: 1, c: 'denied', at: '' }) } });
  w3.ctx.PrimeAnalytics.allow();
  check('Settings on again: the counter starts at once', choiceOf(w3) === 'granted' && !!tag(w3));
}
{
  // the consent page itself never loads the counter
  const w = world(ON, { page: 'analytics', lang: 'ru' });
  const ctl = w.root.all().find((e) => e.id === 'pt-analytics-controls')!;
  const btns = ctl.all().filter((e) => e.tag === 'button').map((e) => e.textContent);
  check('the consent page (legal/<lang>/analytics.html): its state and «Разрешить» / «Отозвать согласие» — and no counter on that page', btns.join('|') === 'Разрешить|Отозвать согласие' && !tag(w) && !banner(w));
}
{
  const css = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') as string;
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(css)?.[1] ?? '';
  check('index.html: the switch and the CSP agree (off → no Yandex host; legal:release --approved adds them together)', /var ENABLED = false;/.test(SHIPPED) ? !/yandex|yastatic/.test(csp) : /script-src 'self' https:\/\/mc\.yandex\.ru https:\/\/yastatic\.net;/.test(csp));
}

console.log(`\nmetrika: ${fail ? 'FAILED' : 'OK'} (${pass} passed, ${fail} failed)`);
if (fail) (proc as any).exitCode = 1;
