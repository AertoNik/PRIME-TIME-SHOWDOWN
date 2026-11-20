// Beta 2.4 — REWARD CASES on the REAL server (its Linux PocketBase, its hooks), against a THROWAWAY instance with an EMPTY
// database reached through an SSH tunnel — never STAGING's or PRODUCTION's data, only test accounts made here:
//
//   PRIME_REMOTE_API=http://127.0.0.1:<tunnel port> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/cases-remote.ts
//
// The instance runs with PRIME_CASES / PRIME_REFERRALS / PRIME_LEAGUE / PRIME_LEAGUE_TOKENS on, mail off, and the dev-only
// force file holding «inv_signal» (the exclusive comes on the FIRST invite case — and must never come again). The game's
// own network code drives it (PrimeApi, SessionManager, SyncManager), as in npm run cases. Prints no password or token.
import PocketBase, { BaseAuthStore } from 'pocketbase';
import { CASES, INVITE_EXCLUSIVE } from '../src/config/cases.config';
import { SaveSystem } from '../src/meta/SaveSystem';
import { userProfile } from '../src/net/accountStore';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { SyncManager } from '../src/net/SyncManager';
import { registrationExtras } from './lib/backendKit';
import { MemoryStorage } from './lib/fixtures';
import { crypto, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = proc.env.PRIME_REMOTE_API ?? '';
const SU = { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !SU.email || !SU.pw) {
  console.log('usage: PRIME_REMOTE_API=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/cases-remote.ts');
  proc.exit(1);
}
const PW = 'Remote2026' + crypto.randomBytes(6).toString('hex');
const tag = crypto.randomBytes(3).toString('hex');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}

type Fetch = typeof fetch;
class Browser {
  storage = new MemoryStorage();
  token = '';
  record: any = null;
  drop: '' | 'response' = '';
  constructor(readonly label: string) {}
  readonly fetchImpl: Fetch = (async (url: any, init?: any) => {
    const r = await fetch(url, init);
    if (this.drop === 'response' && String(url).includes('/api/prime/cases/open')) {
      await r.text();
      throw new TypeError('Failed to fetch');
    }
    return r;
  }) as Fetch;
  api(): PrimeApi {
    const client = new PocketBase(API, new BaseAuthStore());
    if (this.token) client.authStore.save(this.token, this.record);
    return new PrimeApi(client, 15000, this.fetchImpl);
  }
  async login(email: string): Promise<void> {
    const a = this.api();
    await a.login(email, PW);
    this.token = a.pb.authStore.token;
    this.record = a.pb.authStore.record;
  }
}
class Page {
  readonly api: PrimeApi;
  readonly save: SaveSystem;
  readonly session: SessionManager;
  readonly sync: SyncManager;
  constructor(readonly b: Browser, uid: string) {
    this.api = b.api();
    this.save = new SaveSystem({ profile: userProfile(uid), storage: b.storage });
    this.session = new SessionManager({ api: this.api, device: this.save.meta.device, label: b.label });
    this.sync = new SyncManager({ save: this.save, api: this.api, storage: b.storage, session: this.session });
  }
  async open(): Promise<string> {
    const st = await this.session.claim();
    if (st !== 'active') return st;
    const r = await this.sync.reconcile();
    if (r === 'ok') this.sync.startSession();
    return r;
  }
}
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PrimeApiError ? e.code : 'thrown';
  }
};

async function main(): Promise<void> {
  const cfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  check('the throwaway instance on the server announces cases, invitations and PRIME LEAGUE', cfg.cases === 1 && cfg.referrals === 1 && cfg.league?.on === true);
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  // (only this throwaway database: the request limits are lifted for the test's bursts, as npm run cases does)
  const rl = (await admin.settings.getAll()).rateLimits;
  check('the migration put the cases limit into this server\'s settings (40 a minute)', rl.rules.some((r: any) => r.label === '/api/prime/cases' && r.maxRequests === 40));
  await admin.settings.update({ rateLimits: { enabled: true, rules: rl.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  const make = async (nick: string) => {
    const email = `${nick.toLowerCase()}-${tag}@cases-remote.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${nick}: ${r.status}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const b = new Browser(nick);
    await b.login(email);
    const p = new Page(b, u.id as string);
    return { id: u.id as string, b, p };
  };
  const host = await make('RemoteHost');
  const friend = await make('RemoteFriend');
  check('two TEST accounts made on the throwaway server; both open the game (session, cloud save)', (await host.p.open()) === 'ok' && (await friend.p.open()) === 'ok');
  const casesOf = async (uid: string, filter = '') => admin.collection('prime_cases').getFullList({ filter: `owner = "${uid}"${filter ? ' && ' + filter : ''}`, sort: 'grantedAt' });

  // ------------------------------------------------------------------ 60 verified minutes
  const code = (await host.p.api.referralStatus()).code;
  await friend.p.api.referralClaim(code);
  const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${friend.id}"` }))[0];
  const fight = (i: number) => admin.collection('league_matches').create({ attacker: friend.id, defKind: 'system', mode: 'duel', sim: 'a141348f2a0dea20', seed: 1, status: 'done', ranked: true, inputs: [[10, 0], [200, 1]], started: link.linkedAt + 1000 + i, expires: link.linkedAt + 300000, finished: link.linkedAt + 90000, outcome: 'win', method: 'ko', result: { duration: 75, cardsUsed: 3, steps: 4500 }, how: 'finish' });
  for (let i = 0; i < 47; i++) await fight(i);
  await host.p.api.referralStatus();
  check('58 m 45 s of verified fights: no case for anybody yet', (await casesOf(host.id)).length === 0 && (await casesOf(friend.id)).length === 0);
  for (let i = 47; i < 49; i++) await fight(i);
  // both sides read at once, ten times each — the confirmation and its two cases are written once
  await Promise.all([...Array.from({ length: 10 }, () => host.p.api.referralStatus()), ...Array.from({ length: 10 }, () => friend.p.api.referralStatus())]);
  const hc = await casesOf(host.id);
  const fc = await casesOf(friend.id);
  check('61 m 15 s: exactly one PRIME INVITE CASE each — the inviter («inviter») and the friend («invitee»), after 20 parallel reads', hc.length === 1 && hc[0].source === 'inviter' && fc.length === 1 && fc[0].source === 'invitee');

  // ------------------------------------------------------------------ opening
  const o1 = await host.p.sync.openCase('invite');
  check('the first invite case: the server drew the exclusive INVITE SIGNAL (force file) into the cloud save — and this device holds the same', o1.ok && o1.case.result?.item === INVITE_EXCLUSIVE && host.p.save.data.cosmetics.owned.includes(INVITE_EXCLUSIVE as any));
  const cloud1 = await host.p.api.getSave();
  check('…the cloud save and the device\'s copy are the same text (one revision)', !!cloud1 && JSON.parse(cloud1.text).cosmetics.owned.includes(INVITE_EXCLUSIVE));
  // four more for the inviter (1 + 4): the lost answer, two more opens, and the LAST one for the race below
  for (let i = 0; i < 4; i++) await admin.collection('prime_cases').create({ owner: host.id, kind: 'invite', ref: `remote:${tag}:${i}`, source: 'inviter', status: 'ready', grantedAt: Date.now() + i, openedAt: 0, openOp: '', revision: 0, hash: '', tier: 0 });
  host.b.drop = 'response';
  const lost = await host.p.sync.openCase('invite');
  host.b.drop = '';
  // (ordered by the server's own openedAt — the cases added above carry this computer's clock, the server's may differ)
  const opened1 = await admin.collection('prime_cases').getFullList({ filter: `owner = "${host.id}" && status = "opened"`, sort: 'openedAt' });
  check('an answer lost on the way: «offline» for the game — the server opened the case once', !lost.ok && lost.code === 'offline' && opened1.length === 2);
  const money0 = host.p.save.data.money;
  const back = await host.p.sync.settleCase();
  const r2 = opened1[1].result;
  const want = r2.kind === 'money' ? money0 + r2.amount : money0;
  check('back online: the SAME result comes again (duplicate) and is applied once', !!back && back.ok && back.duplicate && back.case.id === opened1[1].id && host.p.save.data.money === want);
  check('the exclusive never comes twice: the force file still says «inv_signal», the next opens give other rewards', await (async () => {
    for (let i = 0; i < 2; i++) {
      const o = await host.p.sync.openCase('invite');
      if (!o.ok || o.case.result?.kind === 'item') return false;
    }
    return true;
  })());
  // the last ready case, two different opens at the same moment (same base revision)
  const base = (await host.p.api.getSave())!.revision;
  const pair = await Promise.all([codeOf(host.p.api.caseOpen('race_a_' + tag, 'invite', base)), codeOf(host.p.api.caseOpen('race_b_' + tag, 'invite', base))]);
  const left = await casesOf(host.id, 'status = "ready"');
  const all = await casesOf(host.id, 'status = "opened"');
  check('two opens at once for the last case: exactly one opens it, the other finds none or a moved revision', pair.filter((x) => x === 'ok').length === 1 && pair.some((x) => x === 'no_case' || x === 'conflict') && left.length === 0, pair.join(','));
  check('every opened case has its own request id (no case opened twice): 5 cases, 5 opens', new Set(all.map((c: any) => c.openOp)).size === all.length && all.length === 5);
  check('…and exactly one exclusive among them', all.filter((c: any) => c.result?.kind === 'item').length === 1);
  await host.p.sync.syncNow?.();

  // ------------------------------------------------------------------ the friend: the invitee's case, DAILY
  const fo = await friend.p.sync.openCase('invite');
  check('the friend opens the invitee\'s case (rewarded as an invitee once)', fo.ok && (await casesOf(friend.id, 'status = "opened"')).length === 1 && (await casesOf(friend.id, 'status = "ready"')).length === 0);
  const m0 = friend.p.save.data.money;
  const d1 = await friend.p.sync.claimDaily();
  check('DAILY day 1 on the server: the case REPLACES the day\'s dollars (0 $ paid), one DAILY case of tier 1', d1.ok && d1.claim.money === 0 && (d1.claim.replaced ?? 0) > 0 && d1.claim.case?.tier === 1 && friend.p.save.data.money === m0);
  const d2 = await friend.p.sync.claimDaily();
  check('the same day again: «already claimed», no second DAILY case', !d2.ok && (await casesOf(friend.id, 'kind = "daily"')).length === 1);
  const dc = await friend.p.sync.openCase('daily');
  const t1 = CASES.daily[0].table;
  const fits = dc.ok && t1.some((x) => x.kind === dc.case.result!.kind && dc.case.result!.amount >= x.min && dc.case.result!.amount <= x.max);
  check('the DAILY case opens with a tier-1 reward inside its range', fits);
  const guest = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('a guest gets nothing: no status, no open (401)', (await codeOf(guest.casesStatus())) !== 'ok' && (await codeOf(guest.caseOpen('g_' + tag, 'invite', 1))) !== 'ok');

  host.p.session.stop?.();
  friend.p.session.stop?.();
  host.p.sync.stop?.();
  friend.p.sync.stop?.();
  console.log(failed ? `\ncases-remote: FAILED (${passed} passed, ${failed} failed)` : `\ncases-remote: OK (${passed} passed, 0 failed)`);
  proc.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.log('cases-remote: stopped — ' + String(e).slice(0, 200));
  proc.exit(1);
});
