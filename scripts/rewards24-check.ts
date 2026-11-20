// Headless checks for Beta 2.4 — REWARDS & REFERRAL EVOLUTION, the game's side (npm run rewards24). The server's side —
// the 60 verified minutes, one case each, no double grant, the draw, the cloud save, PRIME TOKENS, the exclusive once,
// DAILY — is npm run cases (a real PocketBase). Here:
//   * the main menu: the gift for a PRIME ID only, «Пригласить друга» for everybody, a guest's way to a PRIME ID;
//   * the odds the windows show are exact: for every table and every exclusion the shown shares add up to 100 %;
//   * ONE WebGL context for all the cases draw (made once, never thrown away or lost on purpose — in the Beta 2.4
//     checks a context lost on purpose took Chromium's whole GPU process down, the game's own context with it);
//   * the opening show: the server's result only, «Пропустить» after the first case, the calm show, an error card with
//     its own way out, «Дальше · N»; a result whose answer was lost comes back once and is told (a toast);
//   * the DAILY window follows the cases; a case is never bought, sold, passed on or paid out.
import { CASES, dailyTierOf, oddsOf, shareLabel, type CaseOutcome } from '../src/config/cases.config';
import { Color } from 'three';
import { COSMETICS } from '../src/config/cosmetics.config';
import { DASH_FX, dashBurst } from '../src/render/cosmeticFx';
import { cosmeticPic, EFFECT_ART } from '../src/ui/effectArt';
import { fallbackHTML } from '../src/ui/artIcons';
import { crypto, fs, proc } from './lib/node';

const checks: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

const menu = read('src/ui/screens/MenuScreen.ts');
const ref = read('src/ui/referralUI.ts');
const daily = read('src/ui/dailyUI.ts');
const caseUI = read('src/ui/caseUI.ts');
const show = read('src/ui/caseOpening.ts');
const rend = read('src/render/caseRenderer.ts');
const sync = read('src/net/SyncManager.ts');
const acc = read('src/game/AccountRuntime.ts');
const css = read('src/styles/main.css');

// ------------------------------------------------------------- the main menu
check('the gift is a PRIME ID\'s: hidden for a guest and when DAILY is off', /btn\.hidden = !d\.supported \|\| gate === 'guest' \|\| gate === 'off';/.test(menu));
check('«Пригласить друга» is there for everybody the server offers invitations to (guests too)', /btn\.hidden = this\.g\.account\?\.serverConfig\?\.referrals !== true;/.test(menu) && /class="ref-btn" data-act="referral" aria-label="Пригласить друга"/.test(menu));
check('a guest\'s invitation window leads to the existing PRIME ID flows («Создать PRIME ID» → registration, «Войти» → sign-in)', /data-ref-register>Создать PRIME ID<\/button><button class="btn ghost" data-ref-login>Войти<\/button>/.test(ref) && /\[data-ref-register\][\s\S]{0,120}openRegister\(g\)/.test(ref) && /\[data-ref-login\][\s\S]{0,120}openLogin\(g\)/.test(ref));
check('the cases waiting show as a number on the gift and on «Пригласить друга»', /put\('\[data-act="referral"\]\.ref-btn', cs\?\.invite\.ready \?\? 0\)/.test(menu) && /put\('\[data-act="daily"\]\.daily-btn', cs\?\.daily\.ready \?\? 0\)/.test(menu));
check('the bottom bar is Beta 2.3\'s again (the owner\'s decision): БОЙЦЫ | КАРЬЕРА over КОЛЛЕКЦИЯ | НАСТРОЙКИ, the «new» numbers not clipped by their buttons', read('src/ui/screens/MenuScreen.ts').includes('<div class="menu-nav skinned">') && /\.menu-nav\.skinned \{[^}]*grid-template-columns: 1fr 1fr;/.test(css) && !/\.menu-nav \.btn\.nav-skin \{[^}]*overflow: hidden/.test(css) && !/menu-nav\.(pics|tetris|compact)/.test(css));

check('…with two fixes only: a «new» number on the skin\'s top-right corner (past the rounded end drawn as the right border, never over the label), 9.5 px labels on phones ≤ 340 px (КОЛЛЕКЦИЯ clear of its emblem)', /\.menu-nav \.btn\.nav-skin \.badge-dot \{\s*top: -7px;\s*right: calc\(2px - var\(--nav-h\) \* var\(--rk\)\);/.test(css) && /@container \(max-width: 340px\) \{\s*\.menu-nav \.btn\.nav-skin \.nav-label \{\s*font-size: 9\.5px;/.test(css));

// ------------------------------------------------------------- the odds as shown
const tables: [string, CaseOutcome[]][] = [['invite', CASES.invite], ...CASES.daily.map((d) => [`daily tier ${d.tier}`, d.table] as [string, CaseOutcome[]])];
const combos = [
  { owned: [] as string[], tokens: true },
  { owned: [] as string[], tokens: false },
  { owned: ['dash_invite_signal'], tokens: true },
  { owned: ['dash_invite_signal'], tokens: false },
];
const labelBp = (s: string) => Math.round(Number(s.replace(' %', '').replace(',', '.')) * 100);
const exact = tables.every(([, t]) =>
  combos.every((c) => {
    const o = oddsOf(t, c);
    return o.reduce((s, x) => s + x.share, 0) === 10000 && o.reduce((s, x) => s + labelBp(shareLabel(x.share)), 0) === 10000 && o.every((x) => labelBp(shareLabel(x.share)) === x.share);
  }),
);
check('every table, every exclusion (exclusive owned / no PRIME TOKENS): the shares shown add up to exactly 100 % («56,25 %», not a rounded 56 %)', exact);
check('examples: all in 45 / 25 / 20 / 6 / 4 %; exclusive owned and no tokens 59,21 / 32,89 / 7,9 %', oddsOf(CASES.invite, combos[0]).map((x) => shareLabel(x.share)).join(' ') === '45 % 25 % 20 % 6 % 4 %' && oddsOf(CASES.invite, combos[3]).map((x) => shareLabel(x.share)).join(' ') === '59,21 % 32,89 % 7,9 %');
check('the streak raises the DAILY case: tier 1 from day 1, tier 2 from day 7, tier 3 from day 30', dailyTierOf(1).tier === 1 && dailyTierOf(6).tier === 1 && dailyTierOf(7).tier === 2 && dailyTierOf(29).tier === 2 && dailyTierOf(30).tier === 3 && dailyTierOf(365).tier === 3);
check('the exclusive is a real collection item: INVITE SIGNAL, a legendary dash effect, earned only (source «referral»), its own art', COSMETICS.dash_invite_signal.slot === 'dashFx' && COSMETICS.dash_invite_signal.rarity === 'legendary' && COSMETICS.dash_invite_signal.source === 'referral' && COSMETICS.dash_invite_signal.art === 'signal');
// the effect in a fight: a dash with INVITE SIGNAL worn, run headless against a recording stand-in for the VFX layer
{
  const calls: string[] = [];
  const rec: any = new Proxy({}, { get: (_t, k) => (k === 'sparks' ? rec : (..._a: unknown[]) => void calls.push(String(k))) });
  const rng: any = { range: (a: number, b: number) => (a + b) / 2 };
  const run = (fx: any) => {
    calls.length = 0;
    try {
      dashBurst(rec, rng, fx, new Color(0xffffff), 0, 0, 3, 1);
      return calls.length;
    } catch {
      return -1;
    }
  };
  const plain = run(null);
  const signal = run(DASH_FX.dash_invite_signal);
  const phantom = run(DASH_FX.dash_phantom);
  check('INVITE SIGNAL works in a fight: worn → DASH_FX «signal»; its dash runs and adds its own glow / rings / sparks to the plain dash, in the range of the other dash effects', DASH_FX.dash_invite_signal === 'signal' && plain > 0 && signal > plain && phantom > plain && signal <= phantom * 4, `plain ${plain}, signal ${signal}, phantom ${phantom}`);
}
// Beta 2.4 final: the owner's picture (PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png) — the case's reward card, MY
// COLLECTION and the previews all draw cosmeticPic → the WebP; the drawing REWARD_ART.signal stays only as its fallback
{
  const sig = (JSON.parse(read('scripts/art/manifest.json')) as { icons: Record<string, Record<string, { src: string; sha256: string; out: Record<string, { file: string; sha256: string }> }>> }).icons.effects.dash_invite_signal;
  const shaOf = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
  const pic = cosmeticPic('dash_invite_signal', 110);
  check('INVITE SIGNAL wears the owner\'s picture: one manifest entry (original byte for byte, sm 256 / md 512 WebP), EFFECT_ART, the case card / collection draw the WebP, the drawing only as fallback', !!sig && sig.src === 'PRIME_TIME_2_2_ART_ASSETS/dash_invite_signal.png' && shaOf(sig.src) === sig.sha256 && Object.keys(sig.out).join() === 'sm,md' && Object.values(sig.out).every((o) => fs.existsSync(`public/${o.file}`) && shaOf(`public/${o.file}`) === o.sha256) && EFFECT_ART.dash_invite_signal === true && /src="[^"]*ui\/effects\/md\/dash_invite_signal\.webp"/.test(pic) && pic.includes('data-fb="fx|dash_invite_signal"') && fallbackHTML('fx|dash_invite_signal').includes('<svg') && /cosmeticPic\(id, 110\)/.test(show));
}
check('…at its own 110 px in the case\'s reward card (the picture fills its box, the box is the size)', /\.case-item-pic \{\s*display: block;\s*width: 110px;\s*height: 110px;/.test(css));
// Beta 2.4 final: no blinking pictures when a tap redraws a screen (КАРЬЕРА's deck and fighters, PRIME LEAGUE's picks)
{
  const dom = read('src/ui/dom.ts');
  const league = read('src/ui/screens/LeagueScreen.ts');
  check('a redraw keeps every loaded picture whose markup is unchanged (the same element, already decoded): setScreenHTML and PRIME LEAGUE\'s screen go through keepImages; only exact markup is reused, loading / failed pictures are not', /export function keepImages\(root: HTMLElement, apply: \(\) => void\): void \{/.test(dom) && /if \(!img\.complete \|\| !img\.naturalWidth\) continue;/.test(dom) && /const k = img\.outerHTML;/.test(dom) && /old\.get\(img\.outerHTML\)/.test(dom) && /img\.replaceWith\(list!\.splice\(i, 1\)\[0\]\);/.test(dom) && /keepImages\(root, \(\) => \{\s*root\.innerHTML = html;\s*\}\);/.test(dom) && /keepImages\(this\.el, \(\) => \{\s*this\.el\.innerHTML = `\$\{head\}<div class="fill scroll lg-scroll">\$\{body\}<\/div>`;\s*\}\);/.test(league) && !/^\s*this\.el\.innerHTML = `\$\{head\}<div class="fill scroll lg-scroll">/m.test(league.replace(/keepImages\(this\.el, \(\) => \{\s*this\.el\.innerHTML/, '')));
}
check('the window says the odds are this account\'s and the server decides; what left the table is explained', caseUI.includes('Шансы — точные, для вашего аккаунта; результат определяет сервер PRIME NETWORK.') && caseUI.includes('INVITE SIGNAL уже у вас') && caseUI.includes('PRIME TOKENS выпадают после входа в PRIME LEAGUE'));

// ------------------------------------------------------------- one WebGL context
const caseFiles = [caseUI, show, read('src/render/caseModels.ts')];
check('ONE renderer for all the cases draw: no other WebGLRenderer in the case code, made lazily in render/caseRenderer.ts', caseFiles.every((s) => !/new WebGLRenderer/.test(s)) && (rend.match(/new WebGLRenderer\(/g) ?? []).length === 1 && /caseRenderer\(\)/.test(caseUI) && /takeCaseRenderer\(token\)/.test(show));
const powerOf = (s: string) => [...s.matchAll(/powerPreference: '([a-z-]+)'/g)].map((m) => m[1]);
check('the cases\' renderer asks for the same GPU as the game\'s (one page on ONE GPU: on a two-GPU Mac a \'default\' context went to the integrated GPU while the game ran on the discrete one)', powerOf(rend).length === 1 && powerOf(read('src/render/Renderer.ts')).length === 1 && powerOf(rend)[0] === powerOf(read('src/render/Renderer.ts'))[0], `cases ${powerOf(rend)}, game ${powerOf(read('src/render/Renderer.ts'))}`);
check('no context is ever lost on purpose (no forceContextLoss anywhere in the game)', !/\.forceContextLoss\(\)/.test([...caseFiles, rend, read('src/render/Renderer.ts')].join('\n')));
check('the show gives the renderer back (parked: out of the page, 1×1) and takes its tap listener off the shared canvas', /canvas\.removeEventListener\('pointerdown', tap\);\s*[\s\S]{0,200}releaseCaseRenderer\(token\);/.test(show) && /c\.remove\(\);[\s\S]{0,120}r\.setSize\(1, 1, false\);/.test(rend));
check('a picture made while a show runs gives the show its size back; an empty picture is not kept', /if \(busy\) \{\s*r\.setPixelRatio\(ratio\);\s*r\.setSize\(size\.x, size\.y, false\);\s*\} else parkCaseRenderer\(\);/.test(caseUI) && /if \(url\.length < 2000\) return '';/.test(caseUI));
check('one 3D picture at a time: the game skips its own render while a show holds the cases\' renderer (the show covers the frame)', /if \(!document\.hidden && !caseRendererBusy\(\)\) this\.renderer\.render\(dtReal\);/.test(read('src/game/Game.ts')) && /\.case-show \{[^}]*inset: 0;/.test(css));
check('the show\'s stage is kept for the page (scene, models, halo, sparks — nothing rebuilt per show), the first show of a kind compiles its shaders before the drop', /let stage: Stage \| null = null;/.test(show) && /st\.models\[kind\] \?\?= buildCase\(kind\)/.test(show) && /renderer\.compileAsync\(scene, camera\)\.then\(go, go\);/.test(show) && !/model\.dispose\(\)/.test(show));
check('no WebGL: the show still opens the case (a drawn case, the same taps, result and card)', /canvas\.className = 'cs-canvas cs-flat';/.test(show) && /renderer\?\.render\(scene, camera\)/.test(show) && /\.cs-flat \.case-img-fb \{/.test(css));

// ------------------------------------------------------------- the show
check('the server decides: the request leaves on the FIRST tap, once (later taps only build the moment)', /const start = \(\) => \{\s*if \(pending\) return;\s*pending = o\.open\(\)/.test(show) && /if \(phase === 'appear' \|\| phase === 'idle' \|\| phase === 'charge'\) \{\s*start\(\);/.test(show));
check('three taps, «Пропустить» only after the first case ever, a calm show for «reduce motion» / «без тряски»', /const TAPS = 3;/.test(show) && /data-cs-skip \$\{seenBefore\(\) && !calm \? '' : 'hidden'\}/.test(show) && /prefers-reduced-motion: reduce/.test(show) && /dataset\.motion === 'off'/.test(show));
check('an error card has its own «Закрыть»; a lost connection says the reward is kept by the server', /<div class="cs-next"><button class="btn teal" data-cs-done>Закрыть<\/button><\/div>/.test(show) && show.includes('Награда уже закреплена за вами на сервере'));
check('«Дальше · N» while cases of this kind wait, then «Готово»; the buttons stay inside the screen', /data-cs-next>Дальше · \$\{more\}<\/button>/.test(show) && /\.cs-next \.btn \{[^}]*min-width: 0;[^}]*font-size: 14px;/.test(css));
check('the halo never ends in a hard line (the 3D view fades out at its edges)', /\.cs-canvas \{[^}]*mask-image: linear-gradient\(180deg, transparent, #000 14%, #000 86%, transparent\);/.test(css));

// ------------------------------------------------------------- a lost answer, DAILY
check('a result whose answer was lost is asked again with the same request id and applied once (the save\'s case mark)', /const fresh = intoSave && save\.data\.cases\.n < res!\.mark;/.test(sync) && /\/\/ Beta 2\.4: so does a case open still unanswered/.test(sync));
check('…and the player is told what came («Кейс открыт: +117 $»)', /if \(c\.ok\) this\.o\.onCaseSettled\?\.\(c\);/.test(sync) && /onCaseSettled: \(c\) => this\.caseSettled\(c\)/.test(acc) && /this\.g\.ui\.toast\(`Кейс открыт: \$\{text\}`\)/.test(acc));
check('a case open still unanswered after a reload / a new sign-in counts as unsynced: the session settles it at once (same request id), not at the next change of progress', /return m\.pending !== null \|\| !!m\.caseOpen \|\| this\.local\(\)\.hash !== m\.hash;/.test(sync));
const coll = read('src/ui/screens/CollectionScreen.ts');
check('INVITE SIGNAL has its own group in the collection\'s awards («PRIME INVITE CASE», the invitation emblem), not «Карьера продюсера»; the effect view never calls an earned effect «купленный»', /\{ id: 'referral', title: 'PRIME INVITE CASE' \}/.test(coll) && /s === 'boss' \|\| s === 'daily' \|\| s === 'referral' \? s : 'career'/.test(coll) && /id === 'referral' \? uiIcon\('invite', 40, 'rw-art'\)/.test(coll) && !coll.includes('купленный эффект'));
check('the DAILY window follows the cases (a late answer, another device) and lets go when it closes', /offCases = onCases\(render\);/.test(daily) && /offCases\?\.\(\);\s*offCases = null;/.test(daily));
check('an ordinary DAILY day is the case (no «+$0»), day 7 and milestones show their dollars and then the case', /if \(withCase && r\.claim\.money === 0\) \{/.test(daily) && /'DAILY PRIME STREAK: кейс дня ждёт в ежедневном эфире'/.test(daily) && /class="dps-case-title">DAILY BROADCAST CASE/.test(daily));

// ------------------------------------------------------------- never for money
const shop = read('src/config/shop.config.ts');
check('a case is never sold, bought, passed on or paid out: no price in the catalogue, no case in PRIME SHOP, the rule in the window', !/price|rub|₽/i.test(read('src/config/cases.config.ts').replace(/\/\/.*$/gm, '')) && !/case/i.test(shop.replace(/\/\/.*$/gm, '').replace(/showcase|caseless/gi, '')) && caseUI.includes('Кейсы бесплатные: их нельзя купить, продать, передать другому игроку или обменять на деньги.'));

let failed = 0;
for (const [name, pass, detail] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${!pass && detail ? ' — ' + detail : ''}`);
}
console.log(failed ? `\nrewards24: FAILED (${failed} of ${checks.length})` : `\nrewards24: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
