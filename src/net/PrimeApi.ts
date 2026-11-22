import { noteServerTime } from '../meta/serverClock';
import type PocketBase from 'pocketbase';
import type { OfferRevision } from '../config/offer.config';
import { APP_VERSION } from '../config/version';
import { orderOf, type PayEnv, type PaymentPage, type ServerOrder } from '../meta/Payments';

// Alpha 1.8.1 — the game's only door to the accounts server: the official PocketBase JS SDK plus
// the PRIME routes (backend/pb_hooks). Every failure becomes a PrimeApiError with a `kind` the
// game understands (no raw server error ever reaches the screen). The browser loads the SDK on
// demand (AccountRuntime): a build without accounts never contains or downloads it.

export type ApiFailKind = 'network' | 'unauthorized' | 'unverified' | 'forbidden' | 'notfound' | 'conflict' | 'rate' | 'invalid' | 'server'
  /** 1.8.3: another page holds the account's game session now (this page may not write). */
  | 'superseded'
  /** 1.8.3: the server wants a game session this request did not carry (a game older than the server). */
  | 'outdated';

export class PrimeApiError extends Error {
  constructor(
    readonly kind: ApiFailKind,
    readonly code: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(code || kind);
    this.name = 'PrimeApiError';
  }
}

export interface Me {
  id: string;
  email: string;
  verified: boolean;
  nickname: string | null;
  created: string;
  save: { revision: number; hash: string; schema: number; updated: string } | null;
  /**
   * 1.8.4: what the account still has to accept before PRIME CLOUD continues ('terms', 'consent',
   * 'age'); [] = nothing (also from a server older than 1.8.4).
   */
  legalNeeds: string[];
}

export interface CloudSave {
  id: string;
  revision: number;
  schema: number;
  hash: string;
  client: string;
  device: string;
  reason: string;
  updated: string;
  text: string;
}

export interface HistoryEntry extends CloudSave {
  created: string;
}

export type PutReason = 'sync' | 'transfer' | 'new' | 'resolve-device' | 'replace-damaged';

export interface PutBody {
  base: number;
  text: string;
  hash: string;
  op: string;
  device: string;
  reason: PutReason;
}

export interface PutResult {
  revision: number;
  hash: string;
  /** The same request (op) had been applied already — nothing was written twice. */
  duplicate: boolean;
  /** …and the account has moved on since (another device wrote after it). */
  superseded: boolean;
  /** The cloud already held exactly this text. */
  unchanged: boolean;
}

export interface RegisterInput {
  nickname: string;
  email: string;
  password: string;
  passwordConfirm: string;
  /** 1.8.2: the PRIME NETWORK invite (closed beta). */
  invite?: string;
  /** 1.8.4: the age in full years and the country (ISO code) the player named — checked by the server. */
  age?: number;
  country?: string;
  lang?: 'ru' | 'en';
  /** 1.8.4: the versions of the documents the player ticked, and of the privacy notice shown. */
  accept?: Record<string, number>;
  privacy?: number;
  /** 1.8.4: the solved one-time challenge (proof of work). */
  pow?: { id: string; nonce: string };
  /** 1.8.4: the hidden field people never fill. */
  website?: string;
}

/** 1.8.4: a document of PRIME ID as the server lists it. */
export interface LegalDoc {
  v: number;
  required: boolean;
}
export type LegalInfo = Record<'terms' | 'consent' | 'privacy', LegalDoc>;

/** 1.8.4: the age rules the server applies (the game only explains them; the server decides). */
export interface AgeConfig {
  min: number;
  self: number;
  rules: Record<string, number>;
  closed: string[];
}

/** 1.8.4: a registration challenge (proof of work). */
export interface Challenge {
  id: string;
  salt: string;
  bits: number;
  expiresAt: number;
}

/** 1.8.2: what the server says about itself (GET /api/prime/config — public, no secrets). */
export type RegistrationMode = 'disabled' | 'invite_only' | 'public';
export interface ServerConfig {
  registration: RegistrationMode;
  inviteRequired: boolean;
  beta: boolean;
  /**
   * The server sends email (verification, password reset). false — including a server too old to
   * say — means none: accounts are confirmed by the administrator and the game promises no letter.
   */
  mail: boolean;
  /**
   * 1.8.3 PRIME CLOUD 2.0: the server enforces ONE active game session per account — cloud writes
   * must carry it. false (a 1.8.2 server, or PRIME_SESSIONS=off) = the 1.8.2 rules, unchanged.
   */
  sessions: boolean;
  heartbeatMs: number;
  ttlMs: number;
  /** 1.8.4: the documents (null: a server older than 1.8.4 — it records nothing). */
  legal: LegalInfo | null;
  age: AgeConfig | null;
  /** 1.8.4: registration needs a solved challenge. */
  pow: boolean;
  /** 1.8.4: export, deletion and «send again» with a timer exist on this server. */
  accountTools: boolean;
  /** 1.8.8 stage 3: PRIME CHECKOUT exists on this server (/api/prime/shop/*). */
  shopCheckout: boolean;
  /**
   * 1.8.8 stage 4: orders, Robokassa's notifications and the registry of rights exist on this server
   * (/api/prime/shop/purchases, /orders/…). Whether payments are switched ON is /api/prime/shop/status.
   */
  shopPayments: boolean;
  /**
   * 1.8.8: what the server sells now (null: a server that does not say) — the items' OFFICIAL prices (pricesKop;
   * null = not approved) and what a payment in this mode asks (chargeKop: the official price, or a staging
   * server's test amount); env «demo» during the official site's demonstration (until demoUntil, Moscow time).
   */
  shop: { selling: boolean; env: PayEnv; pricesKop: Record<string, number | null>; chargeKop: Record<string, number | null>; demoUntil: string } | null;
  /** 1.8.9: DAILY PRIME STREAK exists and is switched on here (/api/prime/daily). */
  daily: boolean;
  /** Beta 2.2: «ПРИГЛАСИТЬ ДРУГА» is switched on here (/api/prime/referral; a server before 2.2: off). */
  referrals: boolean;
  /** Beta 2.4: REWARD CASES are switched on here (/api/prime/cases; a server before 2.4: off). */
  cases: boolean;
  /** Beta 2.6: DAILY MISSIONS are switched on here (/api/prime/missions; a server before 2.6: off). */
  missions: boolean;
  /** 1.9.0 PRIME LEAGUE on this server (PRIME_LEAGUE=on), the participation rules version and the fight's SIM_VERSION. */
  league: { on: boolean; rules: number; sim: string | null };
  /** 1.9.0 PRIME PRODUCER AVATARS on this server: the catalogue version (0: a server before 1.9.0). */
  producer: number;
  /** 1.9.7 WINTER SHOWDOWN: this server keeps the seasonal wallet of these secure events (a server before 1.9.7: none). */
  season: { on: boolean; events: string[] };
}

/** 1.9.7 (R-22) — a secure event's wallet as the server states it (lib/season.js view). */
export interface SeasonWallet {
  event: string;
  phase: 'none' | 'announce' | 'running' | 'over';
  now: number;
  day: string;
  balance: number;
  earned: number;
  fights: number;
  spent: number;
  dayCareer: number;
  dayLeague: number;
  caps: { career: number; league: number };
  quests: Record<string, { p: number; claimed: boolean }>;
  grandClaimed: boolean;
  owned: { cosmetics: string[]; fighters: string[] };
}

/** 1.8.9 DAILY PRIME STREAK — one day's reward as the server states it (the table: src/config/daily.config.ts). */
export interface DailyRewardInfo {
  day: number;
  money: number;
  kind: 'daily' | 'weekly' | 'milestone';
  milestone: number;
  label: string;
}

/** 1.8.9: the account's streak today, as the PRIME NETWORK server sees it (its own clock, Moscow game days). */
export interface DailyStatus {
  today: number;
  /** The server's «now» and the start of its next game day (ms). */
  now: number;
  nextDayAt: number;
  streak: number;
  best: number;
  claims: number;
  total: number;
  claimedToday: boolean;
  canClaim: boolean;
  /** Claiming now starts a new streak (it broke) / forgives yesterday with the free shield. */
  willReset: boolean;
  willShield: boolean;
  next: DailyRewardInfo;
  upcoming: DailyRewardInfo[];
  milestones: { day: number; money: number; title: string; short: string; reached: boolean; on: number; cosmetic: string | null }[];
  nextMilestone: { day: number; title: string; short: string; money: number; left: number };
  /** ready: a miss of the next day would be forgiven; else it is ready again on game day readyOn. */
  shield: { ready: boolean; usedOn: number; readyOn: number; days: number };
  /** 1.9.6 (an older server: [] / 0 / null): the exclusive items earned, the pause (missed days in a row forgiven), the
   * checkpoint the streak keeps, the checkpoint a claim after a break goes on from, the last day that still continues. */
  items: string[];
  grace: number;
  checkpoint: number;
  returnTo: number | null;
  lastChanceDay: number;
  history: { day: number; streakDay: number; money: number; kind: string; milestone: number }[];
  /** Beta 2.4: the server gives a DAILY BROADCAST CASE instead of an ordinary day's dollars (false: an older server). */
  cases: boolean;
}

/** 1.8.9: what one claim paid (written into the cloud save by the server). */
export interface DailyClaim {
  seq: number;
  day: number;
  streakDay: number;
  money: number;
  kind: 'daily' | 'weekly' | 'milestone';
  milestone: number;
  label: string;
  shield: boolean;
  reset: boolean;
  /** The milestone reached for the first time ever. */
  first: boolean;
  /** 1.9.6: the exclusive item that milestone gave (null: none / an older server); the checkpoint a break went back to. */
  cosmetic: string | null;
  from: number;
  /** Beta 2.4: the DAILY BROADCAST CASE this claim gave (its tier) and the ordinary day's dollars it replaced. */
  case: { kind: 'daily'; tier: number } | null;
  replaced: number;
}

export interface DailyClaimResult {
  claim: DailyClaim;
  /** The cloud save revision and hash the reward was written into. */
  revision: number;
  hash: string;
  duplicate: boolean;
  status: DailyStatus | null;
}

/** 1.8.8 stage 3: the offer revision in force as the server states it (the same shape as offer.config.ts). */
export type ServerOffer = OfferRevision;

/** 1.8.8 stage 3: GET /api/prime/shop/status — the signed-in account and PRIME SHOP, as the server sees them. */
export interface ShopServerStatus {
  verified: boolean;
  legalNeeds: string[];
  offer: ServerOffer | null;
  /** The newest offer revision this account accepted (0: none). */
  acceptedRevision: number;
  sales: boolean;
  payments: boolean;
  /** Confirmed purchases (skus) of this account — the server's registry of rights (stage 4). */
  owned: string[];
  /** 1.8.8 stage 4: «test» / «demo» on a server in Robokassa's test mode (every step is labelled a test payment). */
  env: PayEnv;
  /** What a payment in that mode asks, in kopecks (null: not for sale; absent: a stage-3 server). */
  pricesKop: Record<string, number | null> | null;
  /** 1.8.8 final: the items' official prices in kopecks (null: not approved; absent: an older server). */
  listKop: Record<string, number | null> | null;
  /** This account's open (unpaid) orders. */
  orders: ServerOrder[];
  /** 1.9.4: the limits for buyers aged 14–17 under the offer revision in force (null: an older server). */
  minors: { orderKop: number; per30DaysKop: number; characters: boolean } | null;
}

/** 1.8.8 stage 4: POST /api/prime/shop/checkout once everything passed — the order and Robokassa's page. */
export interface CheckoutStart {
  order: ServerOrder;
  /** As the server sent it — PrimeCheckout checks it (checkPaymentPage) before leaving for it. */
  payment: unknown;
  /** The same open order again (a repeated tap): the same InvId, never a second payment. */
  reused: boolean;
}

export type { PaymentPage, ServerOrder };

/** 1.8.3: the page's game session, sent with every cloud write (the key is random and lives only in memory). */
export interface SessionToken {
  key: string;
  generation: number;
}

export interface ClaimResult {
  generation: number;
  /** The page that held the session until now, if it was still active (its coarse device name). */
  previous: { label: string } | null;
  heartbeatMs: number;
  ttlMs: number;
}

/** After a registration: was the verification letter sent, or does the account wait for the administrator? */
export interface RegisterResult {
  mailSent: boolean;
  manual: boolean;
  /** 1.8.4: seconds until «send again» is allowed. */
  retryAfter: number;
}

/** Email as the server stores it (registration lower-cases it; sign-in compares exactly). */
export const normEmail = (e: string) => e.trim().toLowerCase();

function toError(e: unknown): PrimeApiError {
  if (e instanceof PrimeApiError) return e;
  const r = e as { status?: number; isAbort?: boolean; response?: Record<string, unknown> } | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'number') return new PrimeApiError('network', 'network', 0);
  const status = r.status;
  const body = (r.response ?? {}) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code : '';
  if (r.isAbort || status === 0) return new PrimeApiError('network', 'network', 0);
  if (status === 401) return new PrimeApiError('unauthorized', code || 'unauthorized', status, body);
  if (status === 403) return new PrimeApiError(code === 'not_verified' ? 'unverified' : 'forbidden', code || 'forbidden', status, body);
  if (status === 404) return new PrimeApiError('notfound', code || 'not_found', status, body);
  if (status === 409 && code === 'session_superseded') return new PrimeApiError('superseded', code, status, body);
  if (status === 409) return new PrimeApiError('conflict', code || 'conflict', status, body);
  if (status === 426) return new PrimeApiError('outdated', code || 'session_required', status, body);
  if (status === 429) return new PrimeApiError('rate', code || 'rate_limited', status, body);
  if (status >= 500) return new PrimeApiError('server', code || 'server_error', status, body);
  return new PrimeApiError('invalid', code || 'invalid', status, body);
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0);

/** Beta 2.2 — an invitation as the server keeps it: the verified seconds of play since the link, and its confirmation. */
export interface ReferralInvitation {
  nickname: string;
  linkedAt: number;
  seconds: number;
  required: number;
  qualified: boolean;
  qualifiedAt: number;
}
export interface ReferralStatus {
  code: string;
  required: number;
  /** Where the verified seconds come from ('league': PRIME LEAGUE fights the server replayed). */
  source: string;
  minCards: number;
  invitedBy: ReferralInvitation | null;
  invited: { total: number; confirmed: number };
  /** Beta 2.4: the invited friends' progress (no names), newest first — at most 50. */
  friends: { linkedAt: number; seconds: number; qualified: boolean }[];
  /** Beta 2.2: false (no reward yet); Beta 2.4: true when a confirmed invitation gives PRIME INVITE CASES. */
  rewards: boolean;
  notice: string;
}
function invitationOf(v: unknown): ReferralInvitation | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Rec;
  return { nickname: str(r.nickname), linkedAt: int(r.linkedAt), seconds: int(r.seconds), required: int(r.required) || 3600, qualified: r.qualified === true, qualifiedAt: int(r.qualifiedAt) };
}
function referralOf(r: Rec): ReferralStatus {
  const inv = (r.invited ?? {}) as Rec;
  return {
    code: /^[A-Z0-9]{8}$/.test(str(r.code)) ? str(r.code) : '',
    required: int(r.required) || 3600,
    source: str(r.source),
    minCards: int(r.minCards),
    invitedBy: invitationOf(r.invitedBy),
    invited: { total: int(inv.total), confirmed: int(inv.confirmed) },
    friends: Array.isArray(r.friends)
      ? r.friends.slice(0, 50).map((f) => {
          const x = (f ?? {}) as Rec;
          return { linkedAt: int(x.linkedAt), seconds: int(x.seconds), qualified: x.qualified === true };
        })
      : [],
    rewards: r.rewards === true,
    notice: str(r.notice),
  };
}
/** A payment environment as the server names it (anything unknown reads as live — never as a test). */
const payEnv = (v: unknown): PayEnv => (v === 'test' || v === 'demo' ? v : 'live');
/** sku → whole kopecks above zero, or null. */
const kopMap = (v: unknown): Record<string, number | null> =>
  Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null]));

const dailyKind = (v: unknown): DailyRewardInfo['kind'] => (v === 'weekly' || v === 'milestone' ? v : 'daily');
const dailyRewardOf = (v: unknown): DailyRewardInfo => {
  const x = (v ?? {}) as Rec;
  return { day: int(x.day), money: Math.max(0, int(x.money)), kind: dailyKind(x.kind), milestone: int(x.milestone), label: str(x.label) };
};

/** The server's daily status, read defensively (anything missing reads as nothing). */
export function dailyStatusOf(r: Rec): DailyStatus {
  const nm = (r.nextMilestone ?? {}) as Rec;
  const sh = (r.shield ?? {}) as Rec;
  return {
    today: int(r.today),
    now: int(r.now),
    nextDayAt: int(r.nextDayAt),
    streak: int(r.streak),
    best: int(r.best),
    claims: int(r.claims),
    total: int(r.total),
    claimedToday: r.claimedToday === true,
    canClaim: r.canClaim === true,
    willReset: r.willReset === true,
    willShield: r.willShield === true,
    next: dailyRewardOf(r.next),
    upcoming: Array.isArray(r.upcoming) ? r.upcoming.slice(0, 14).map(dailyRewardOf) : [],
    milestones: Array.isArray(r.milestones)
      ? r.milestones.slice(0, 12).map((m) => {
          const x = (m ?? {}) as Rec;
          return { day: int(x.day), money: int(x.money), title: str(x.title), short: str(x.short), reached: x.reached === true, on: int(x.on), cosmetic: typeof x.cosmetic === 'string' ? x.cosmetic : null };
        })
      : [],
    nextMilestone: { day: int(nm.day), title: str(nm.title), short: str(nm.short), money: int(nm.money), left: int(nm.left) },
    shield: { ready: sh.ready === true, usedOn: int(sh.usedOn), readyOn: int(sh.readyOn), days: int(sh.days) || 7 },
    items: Array.isArray(r.items) ? r.items.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    grace: int(r.grace),
    checkpoint: int(r.checkpoint),
    returnTo: typeof r.returnTo === 'number' ? int(r.returnTo) : null,
    lastChanceDay: int(r.lastChanceDay),
    history: Array.isArray(r.history)
      ? r.history.slice(0, 20).map((h) => {
          const x = (h ?? {}) as Rec;
          return { day: int(x.day), streakDay: int(x.streakDay), money: int(x.money), kind: str(x.kind), milestone: int(x.milestone) };
        })
      : [],
    cases: r.cases === true,
  };
}
// ------------------------------------------------------------ Beta 2.4 REWARD CASES
export type CaseKind = 'invite' | 'daily' | 'mission';
export type CaseRewardKind = 'money' | 'rep' | 'tokens' | 'item';
/** One line of a case's odds as the server states them for this player (share: basis points, sums to 10 000). */
export interface CaseOddsLine {
  id: string;
  kind: CaseRewardKind;
  min: number;
  max: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  label: string;
  item: string | null;
  share: number;
}
/** What one opened case gave (decided and written by the server). */
export interface CaseReward {
  kind: CaseRewardKind;
  outcome: string;
  label: string;
  rarity: CaseOddsLine['rarity'];
  share: number;
  amount: number;
  item: string | null;
  /** The save's case mark after this reward (money / reputation / item); 0: nothing went into the save (tokens). */
  mark: number;
  /** PRIME TOKENS: the league balance after it. */
  balance: number;
}
export interface CaseRecord {
  id: string;
  kind: CaseKind;
  tier: number;
  openedAt: number;
  result: CaseReward | null;
}
export interface CasesStatus {
  exclusive: { item: string; owned: boolean };
  tokens: boolean;
  invite: { ready: number; opened: number; odds: CaseOddsLine[] };
  daily: { ready: number; opened: number; tier: number; odds: CaseOddsLine[] };
  /** Beta 2.6: DAILY MISSION MINI CASE (a server without it: zero ready, no odds). */
  mission: { ready: number; opened: number; odds: CaseOddsLine[] };
  history: CaseRecord[];
}
export interface CaseOpenResult {
  case: CaseRecord;
  revision: number;
  hash: string;
  duplicate: boolean;
  status: CasesStatus | null;
}
const caseKind = (v: unknown): CaseKind => (v === 'invite' ? 'invite' : v === 'mission' ? 'mission' : 'daily');
const rewardKind = (v: unknown): CaseRewardKind => (v === 'money' || v === 'rep' || v === 'tokens' || v === 'item' ? v : 'money');
const rarityOf = (v: unknown): CaseOddsLine['rarity'] => (v === 'rare' || v === 'epic' || v === 'legendary' ? v : 'common');
function oddsLines(v: unknown): CaseOddsLine[] {
  return Array.isArray(v)
    ? v.slice(0, 12).map((x) => {
        const o = (x ?? {}) as Rec;
        return { id: str(o.id), kind: rewardKind(o.kind), min: int(o.min), max: int(o.max), rarity: rarityOf(o.rarity), label: str(o.label), item: typeof o.item === 'string' ? o.item : null, share: Math.max(0, int(o.share)) };
      })
    : [];
}
function caseRewardOf(v: unknown): CaseReward | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Rec;
  return { kind: rewardKind(r.kind), outcome: str(r.outcome), label: str(r.label), rarity: rarityOf(r.rarity), share: int(r.share), amount: Math.max(0, int(r.amount)), item: typeof r.item === 'string' ? r.item : null, mark: int(r.mark), balance: int(r.balance) };
}
function caseRecordOf(v: unknown): CaseRecord {
  const r = (v ?? {}) as Rec;
  return { id: str(r.id), kind: caseKind(r.kind), tier: int(r.tier), openedAt: int(r.openedAt), result: caseRewardOf(r.result) };
}
export function casesStatusOf(r: Rec): CasesStatus {
  const ex = (r.exclusive ?? {}) as Rec;
  const inv = (r.invite ?? {}) as Rec;
  const day = (r.daily ?? {}) as Rec;
  const mis = (r.mission ?? {}) as Rec;
  return {
    exclusive: { item: str(ex.item), owned: ex.owned === true },
    tokens: r.tokens === true,
    invite: { ready: int(inv.ready), opened: int(inv.opened), odds: oddsLines(inv.odds) },
    daily: { ready: int(day.ready), opened: int(day.opened), tier: int(day.tier) || 1, odds: oddsLines(day.odds) },
    mission: { ready: int(mis.ready), opened: int(mis.opened), odds: oddsLines(mis.odds) },
    history: Array.isArray(r.history) ? r.history.slice(0, 20).map(caseRecordOf) : [],
  };
}

// ------------------------------------------------------------ Beta 2.6 DAILY MISSIONS
export interface MissionView {
  i: number;
  id: string;
  title: string;
  tier: 'easy' | 'medium' | 'hard';
  league: boolean;
  target: number;
  progress: number;
  done: boolean;
  /** Its mini case was granted (it waits in the cases until opened). */
  rewarded: boolean;
}
export interface MissionsStatus {
  day: number;
  now: number;
  /** When the next set comes (00:00 Moscow time, the server's clock). */
  resetsAt: number;
  missions: MissionView[];
  cases: { ready: number };
}
/** What the game reports of a finished career fight (the server clamps and checks it). */
export interface MissionFightReport {
  outcome: 'win' | 'loss' | 'draw';
  method: 'ko' | 'time' | 'forfeit';
  rating: number;
  combos: number;
  perfects: number;
  difficulty: 'rookie' | 'pro' | 'champion';
  mode: 'classic' | 'challenge' | 'boss';
  fighter: string;
  rival: string;
  seconds: number;
}
export interface MissionReportResult {
  counted: boolean;
  duplicate: boolean;
  /** Ids of missions this fight completed (each gave its mini case). */
  completed: string[];
  state: MissionsStatus | null;
}
const tierOf = (v: unknown): MissionView['tier'] => (v === 'medium' || v === 'hard' ? v : 'easy');
export function missionsStatusOf(r: Rec): MissionsStatus {
  const list = Array.isArray(r.missions) ? r.missions.slice(0, 5) : [];
  return {
    day: int(r.day),
    now: int(r.now),
    resetsAt: int(r.resetsAt),
    missions: list.map((x, k) => {
      const m = (x ?? {}) as Rec;
      return { i: typeof m.i === 'number' ? int(m.i) : k, id: str(m.id), title: str(m.title), tier: tierOf(m.tier), league: m.league === true, target: Math.max(1, int(m.target)), progress: Math.max(0, int(m.progress)), done: m.done === true, rewarded: m.rewarded === true };
    }),
    cases: { ready: Math.max(0, int(((r.cases ?? {}) as Rec).ready)) },
  };
}

function cloudSaveOf(r: Rec): CloudSave {
  return {
    id: str(r.id),
    revision: int(r.revision),
    schema: int(r.schema),
    hash: str(r.hash),
    client: str(r.client),
    device: str(r.device),
    reason: str(r.reason),
    updated: str(r.updated),
    text: str(r.data),
  };
}

export class PrimeApi {
  /** 1.8.3: the game session this page holds (set by SessionManager); attached to every cloud write. */
  session: SessionToken | null = null;

  constructor(
    readonly pb: PocketBase,
    private readonly timeoutMs = 10000,
    /** Replaces fetch for every request (the checks use it to lose a reply on purpose). */
    private readonly fetchImpl?: typeof fetch,
  ) {
    // the SDK would cancel a request when the next one to the same endpoint starts — never wanted here
    pb.autoCancellation(false);
  }

  /** The account in the stored session (also offline; may be expired). */
  get sessionRecord(): { id: string; email: string; verified: boolean } | null {
    const r = this.pb.authStore.record as Record<string, unknown> | null;
    if (!this.pb.authStore.token || !r || typeof r.id !== 'string') return null;
    return { id: r.id, email: str(r.email), verified: r.verified === true };
  }

  get userId(): string | null {
    return this.pb.authStore.isValid ? (str(this.pb.authStore.record?.id) || null) : null;
  }

  get signedIn(): boolean {
    return this.userId !== null;
  }

  private async call<T>(fn: (o: { signal: AbortSignal; requestKey: null; keepalive?: boolean; fetch?: typeof fetch }) => Promise<T>, keepalive = false, timeoutMs = this.timeoutMs): Promise<T> {
    const ctl = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    try {
      return await fn({ signal: ctl.signal, requestKey: null, ...(keepalive ? { keepalive: true } : {}), ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });
    } catch (e) {
      // 1.8.9: no answer in time (kind «network», code «timeout») — apart from no connection at all
      if (timedOut && !(e instanceof PrimeApiError)) throw new PrimeApiError('network', 'timeout', 0);
      throw toError(e);
    } finally {
      clearTimeout(t);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.call((o) => this.pb.health.check(o));
      return true;
    } catch {
      return false;
    }
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const body: Rec = { nickname: input.nickname.trim(), email: normEmail(input.email), password: input.password, passwordConfirm: input.passwordConfirm };
    if (input.invite) body.invite = input.invite.trim();
    for (const k of ['age', 'country', 'lang', 'accept', 'privacy', 'pow', 'website'] as const) if (input[k] !== undefined) body[k] = input[k];
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/register', { ...o, method: 'POST', body }));
    return { mailSent: r.mailSent === true, manual: r.verification === 'manual', retryAfter: int(r.retryAfter) || 60 };
  }

  /** 1.8.4: a fresh one-time challenge for the next registration attempt. */
  async challenge(): Promise<Challenge> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/challenge', { ...o, method: 'POST' }));
    return { id: str(r.id), salt: str(r.salt), bits: int(r.bits), expiresAt: int(r.expiresAt) };
  }

  /** 1.8.4: «send the email again» for the signed-in account; the seconds until the next one. */
  async resendMine(): Promise<{ verified: boolean; retryAfter: number }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/verify/resend', { ...o, method: 'POST' }));
    return { verified: r.verified === true, retryAfter: int(r.retryAfter) };
  }

  /** 1.8.4: accept the current documents (and answer the age question); what is still needed afterwards. */
  async acceptLegal(b: { accept: Record<string, number>; privacy?: number; lang: 'ru' | 'en'; age?: number; country?: string }): Promise<string[]> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/legal/accept', { ...o, method: 'POST', body: b }));
    const l = (r.legal ?? {}) as Rec;
    return Array.isArray(l.needs) ? l.needs.filter((x): x is string => typeof x === 'string') : [];
  }

  /** 1.8.4: everything the server keeps about the signed-in account. */
  async exportData(): Promise<Rec> {
    return this.call((o) => this.pb.send<Rec>('/api/prime/account/export', { ...o, method: 'GET' }));
  }

  /** 1.8.4: delete the signed-in account for good (its password again). */
  async deleteAccount(password: string): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/account/delete', { ...o, method: 'POST', body: { password, confirm: 'DELETE' } }));
    this.pb.authStore.clear();
  }

  /**
   * The server's registration mode. An unreadable or unknown answer counts as «disabled»: the game
   * never offers a registration the server has not opened.
   */
  async config(): Promise<ServerConfig> {
    const sentAt = Date.now();
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/config', { ...o, method: 'GET' }));
    // 1.9.5: the server's clock for the seasonal calendar (absent on older servers — the device clock stays)
    noteServerTime(r.time, sentAt, Date.now());
    const m = r.registration === 'invite_only' || r.registration === 'public' ? r.registration : 'disabled';
    const sess = (r.session ?? {}) as Rec;
    const legal = r.legal && typeof r.legal === 'object' ? (r.legal as Rec) : null;
    const doc = (d: unknown): LegalDoc => ({ v: int((d as Rec | undefined)?.v), required: (d as Rec | undefined)?.required === true });
    const age = r.age && typeof r.age === 'object' ? (r.age as Rec) : null;
    return {
      registration: m,
      inviteRequired: m === 'invite_only',
      beta: m === 'invite_only',
      mail: r.mail === true,
      sessions: r.sessions === 1,
      heartbeatMs: Math.min(60000, Math.max(5000, int(sess.heartbeatMs) || 20000)),
      ttlMs: Math.min(300000, Math.max(30000, int(sess.ttlMs) || 75000)),
      legal: legal ? { terms: doc(legal.terms), consent: doc(legal.consent), privacy: doc(legal.privacy) } : null,
      age: age
        ? {
            min: int(age.min) || 14,
            self: int(age.self) || 18,
            rules: Object.fromEntries(Object.entries((age.rules ?? {}) as Rec).filter(([k, v]) => /^[A-Z]{2}$/.test(k) && typeof v === 'number')) as Record<string, number>,
            closed: Array.isArray(age.closed) ? age.closed.filter((c): c is string => typeof c === 'string') : [],
          }
        : null,
      pow: r.pow === 1,
      accountTools: r.account === 1,
      shopCheckout: ((r.shop ?? {}) as Rec).checkout === 1,
      shopPayments: ((r.shop ?? {}) as Rec).payments === 1,
      shop: (() => {
        const sh = (r.shop ?? {}) as Rec;
        if (sh.payments !== 1 || !sh.prices || typeof sh.prices !== 'object') return null;
        const pricesKop = kopMap(sh.prices);
        return {
          selling: sh.selling === true,
          env: payEnv(sh.env),
          pricesKop,
          // (a server without «charge» charges the listed price)
          chargeKop: sh.charge && typeof sh.charge === 'object' ? kopMap(sh.charge) : pricesKop,
          demoUntil: typeof sh.demoUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sh.demoUntil) ? sh.demoUntil : '',
        };
      })(),
      daily: r.daily === 1,
      referrals: r.referrals === 1,
      cases: r.cases === 1,
      missions: r.missions === 1,
      league: (() => {
        const l = (r.league ?? {}) as Rec;
        return { on: l.on === true, rules: int(l.rules), sim: typeof l.sim === 'string' ? l.sim : null };
      })(),
      producer: int(r.producer),
      season: (() => {
        const v = (r.season ?? {}) as Rec;
        return { on: v.on === true, events: Array.isArray(v.events) ? v.events.filter((x): x is string => typeof x === 'string') : [] };
      })(),
    };
  }

  // ------------------------------------------------------- 1.9.7 WINTER SHOWDOWN (R-22)
  /** The account's wallet of a secure event (GET), or one of its actions (POST — with this page's game session). */
  async season<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const b = method === 'POST' ? { ...(body ?? {}), ...this.sessionBody() } : undefined;
    return this.call((o) => this.pb.send<T>('/api/prime/season' + path, { ...o, method, ...(b ? { body: b } : {}) }));
  }

  /** 1.9.0: the signed-in account's producer look (the server's — never a local copy). */
  async producerGet(): Promise<{ avatar: string; frame: string; backdrop: string; rev: number; chosen: boolean }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/producer', { ...o, method: 'GET' }));
    return r.look as { avatar: string; frame: string; backdrop: string; rev: number; chosen: boolean };
  }

  /** 1.9.0: save the look — `rev` is the revision this page saw (another tab saved meanwhile → look_changed). */
  async producerPut(look: { avatar: string; frame: string; backdrop: string }, rev: number): Promise<{ avatar: string; frame: string; backdrop: string; rev: number; chosen: boolean }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/producer', { ...o, method: 'POST', body: { ...look, rev } }));
    return r.look as { avatar: string; frame: string; backdrop: string; rev: number; chosen: boolean };
  }

  /**
   * 1.9.0 PRIME LEAGUE: one request to /api/prime/league/* as the signed-in account (src/net/LeagueApi.ts shapes the
   * answers). Errors come back as PrimeApiError with the server's code (league_off, match_active, too_early…).
   */
  async league<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this.call((o) => this.pb.send<T>('/api/prime/league' + path, { ...o, method, ...(body ? { body } : {}) }), false, timeoutMs ?? this.timeoutMs);
  }

  // ------------------------------------------------------- 1.8.9 DAILY PRIME STREAK
  /** The account's streak today (a verified PRIME ID). */
  /** Beta 2.2: the account's referral code, its invitation and how many it invited (the server makes the code). */
  async referralStatus(): Promise<ReferralStatus> {
    return referralOf(await this.call((o) => this.pb.send<Rec>('/api/prime/referral', { ...o, method: 'GET' })));
  }

  /** Beta 2.2: link this account to a friend's code — once; the answer is the invitation as the server keeps it. */
  async referralClaim(code: string): Promise<ReferralInvitation | null> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/referral/claim', { ...o, method: 'POST', body: { code } }));
    return invitationOf(r.invitedBy);
  }

  async dailyStatus(): Promise<DailyStatus> {
    return dailyStatusOf(await this.call((o) => this.pb.send<Rec>('/api/prime/daily', { ...o, method: 'GET' })));
  }

  /**
   * Today's reward: the server pays it into the cloud save revision `base` (the one this page is in step with) and
   * answers with the new revision. The request names nothing else — a repeat with the same op is answered again.
   */
  async dailyClaim(op: string, base: number): Promise<DailyClaimResult> {
    // (Beta 2.4: cases: 1 — this game shows a DAILY BROADCAST CASE instead of an ordinary day's dollars)
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/daily/claim', { ...o, method: 'POST', body: { op, base, cases: 1, ...this.sessionBody() } }));
    const c = (r.claim ?? {}) as Rec;
    return {
      claim: {
        seq: int(c.seq),
        day: int(c.day),
        streakDay: int(c.streakDay),
        money: Math.max(0, int(c.money)),
        kind: dailyKind(c.kind),
        milestone: int(c.milestone),
        label: str(c.label),
        shield: c.shield === true,
        reset: c.reset === true,
        first: c.first === true,
        cosmetic: typeof c.cosmetic === 'string' ? c.cosmetic : null,
        from: int(c.from),
        case: c.case && typeof c.case === 'object' ? { kind: 'daily', tier: int((c.case as Rec).tier) || 1 } : null,
        replaced: Math.max(0, int(c.replaced)),
      },
      revision: int(r.revision),
      hash: str(r.hash),
      duplicate: r.duplicate === true,
      status: r.status && typeof r.status === 'object' ? dailyStatusOf(r.status as Rec) : null,
    };
  }

  // ------------------------------------------------------------ Beta 2.4 REWARD CASES
  async casesStatus(): Promise<CasesStatus> {
    return casesStatusOf(await this.call((o) => this.pb.send<Rec>('/api/prime/cases', { ...o, method: 'GET' })));
  }

  /**
   * Opens this account's oldest waiting case of `kind`: the server draws and writes the reward into the cloud save
   * revision `base` (or the league token ledger) and answers with what it gave. A repeat with the same op is answered
   * again with the same result.
   */
  async caseOpen(op: string, kind: CaseKind, base: number): Promise<CaseOpenResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/cases/open', { ...o, method: 'POST', body: { op, kind, base, ...this.sessionBody() } }));
    return { case: caseRecordOf(r.case), revision: int(r.revision), hash: str(r.hash), duplicate: r.duplicate === true, status: r.status && typeof r.status === 'object' ? casesStatusOf(r.status as Rec) : null };
  }

  // ------------------------------------------------------------ Beta 2.6 DAILY MISSIONS
  /** Today's five missions (the server picks them once a game day and keeps them). */
  async missionsStatus(): Promise<MissionsStatus> {
    return missionsStatusOf(await this.call((o) => this.pb.send<Rec>('/api/prime/missions', { ...o, method: 'GET' })));
  }

  /**
   * A finished career fight for today's missions. The server clamps the figures, checks the time bank and the session,
   * and counts each op once (a repeat answers «duplicate»); an exit from the fight counts nothing.
   */
  async missionReport(op: string, fight: MissionFightReport): Promise<MissionReportResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/missions/report', { ...o, method: 'POST', body: { op, fight, ...this.sessionBody() } }));
    return { counted: r.counted === true, duplicate: r.duplicate === true, completed: Array.isArray(r.completed) ? r.completed.filter((x): x is string => typeof x === 'string').slice(0, 5) : [], state: r.state && typeof r.state === 'object' ? missionsStatusOf(r.state as Rec) : null };
  }

  // ------------------------------------------------------------ PRIME CHECKOUT (1.8.8 stage 3)
  /** The signed-in account and PRIME SHOP: documents, the offer and this account's consent, sales, payments. */
  async shopStatus(): Promise<ShopServerStatus> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/shop/status', { ...o, method: 'GET' }));
    const off = r.offer && typeof r.offer === 'object' ? (r.offer as Rec) : null;
    const l = (r.legal ?? {}) as Rec;
    return {
      verified: r.verified === true,
      legalNeeds: Array.isArray(l.needs) ? l.needs.filter((x): x is string => typeof x === 'string') : [],
      offer: off ? { revision: int(off.revision), sha256: str(off.sha256), title: str(off.title), url: str(off.url), effectiveFrom: str(off.effectiveFrom) } : null,
      acceptedRevision: int(r.accepted),
      sales: r.sales === true,
      payments: r.payments === true,
      owned: Array.isArray(r.owned) ? r.owned.filter((x): x is string => typeof x === 'string') : [],
      env: payEnv(r.env),
      pricesKop: r.prices && typeof r.prices === 'object' ? kopMap(r.prices) : null,
      listKop: r.listPrices && typeof r.listPrices === 'object' ? kopMap(r.listPrices) : null,
      orders: Array.isArray(r.orders) ? r.orders.map(orderOf).filter((o): o is ServerOrder => o !== null) : [],
      minors: r.minors && typeof r.minors === 'object' ? { orderKop: int((r.minors as Rec).orderKop), per30DaysKop: int((r.minors as Rec).per30DaysKop), characters: (r.minors as Rec).characters === true } : null,
    };
  }

  /** Accept the CURRENT offer revision (the server checks it is the one in force); the accepted revision. */
  async acceptOffer(revision: number, sha256: string, lang: 'ru' | 'en'): Promise<number> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/shop/offer/accept', { ...o, method: 'POST', body: { revision, sha256, lang } }));
    return int(r.accepted);
  }

  /**
   * Start a purchase of `sku`. Only the sku is sent — never a price, an account or a status: the server takes
   * the price from its own list and the account from the session, checks everything again and makes the
   * order (or gives back the open one) with Robokassa's signed payment page. A refusal is a PrimeApiError with
   * the reason in `code` (owned, sales_closed, offer_consent_required, payments_unavailable, too_many_orders…).
   */
  async startCheckout(sku: string): Promise<CheckoutStart> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/shop/checkout', { ...o, method: 'POST', body: { sku } }));
    const order = orderOf(r.order);
    // anything but an order is «not available» (never a guess that something was bought)
    if (!order) throw new PrimeApiError('server', 'payments_unavailable', 503);
    return { order, payment: r.payment, reused: r.reused === true };
  }

  /** 1.8.8 stage 4: one of this account's orders as the server sees it, and the account's rights now. */
  async order(inv: number): Promise<{ order: ServerOrder; owned: string[] }> {
    const r = await this.call((o) => this.pb.send<Rec>(`/api/prime/shop/orders/${Math.floor(inv)}`, { ...o, method: 'GET' }));
    const order = orderOf(r.order);
    if (!order) throw new PrimeApiError('server', 'bad_answer', 502);
    return { order, owned: Array.isArray(r.owned) ? r.owned.filter((x): x is string => typeof x === 'string') : [] };
  }

  /** 1.8.8 stage 4: what this PRIME ID owns from PRIME SHOP and its latest orders (every device, every sign-in). */
  async purchases(): Promise<{ env: PayEnv; owned: string[]; orders: ServerOrder[] }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/shop/purchases', { ...o, method: 'GET' }));
    return {
      env: payEnv(r.env),
      owned: Array.isArray(r.owned) ? r.owned.filter((x): x is string => typeof x === 'string' && x.length <= 64) : [],
      orders: Array.isArray(r.orders) ? r.orders.map(orderOf).filter((o): o is ServerOrder => o !== null) : [],
    };
  }

  // ------------------------------------------------------------ game sessions (1.8.3)
  /** This page becomes the account's active game session (only on opening the game or «Продолжить здесь»). */
  async claimSession(key: string, label: string, device: string): Promise<ClaimResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/session/claim', { ...o, method: 'POST', body: { key, label, device } }));
    const prev = r.previous as Rec | null;
    return { generation: int(r.generation), previous: prev && typeof prev === 'object' ? { label: str(prev.label) } : null, heartbeatMs: int(r.heartbeatMs) || 20000, ttlMs: int(r.ttlMs) || 75000 };
  }

  /** «Still here» — never takes the session back (409 → kind 'superseded'). */
  async heartbeat(s: SessionToken): Promise<{ generation: number; renewed: boolean }> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/session/heartbeat', { ...o, method: 'POST', body: { session: s } }));
    return { generation: int(r.generation), renewed: r.renewed === true };
  }

  /** Free the session (signing out, playing as a guest here). Best effort. */
  async releaseSession(s: SessionToken, keepalive = false): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/session/release', { ...o, method: 'POST', body: { session: s } }), keepalive);
  }

  /** The session part of a cloud write's body (nothing when no session is held — a 1.8.2 server needs none). */
  private sessionBody(): { session?: SessionToken } {
    return this.session ? { session: { key: this.session.key, generation: this.session.generation } } : {};
  }

  async login(email: string, password: string): Promise<Me> {
    await this.call((o) => this.pb.collection('users').authWithPassword(normEmail(email), password, o));
    return this.me();
  }

  /** Renew the session token (and read the account again). 401 = the session is over: signed out. */
  async refresh(): Promise<Me> {
    try {
      await this.call((o) => this.pb.collection('users').authRefresh(o));
    } catch (e) {
      const err = toError(e);
      if (err.kind === 'unauthorized' || err.kind === 'notfound') this.pb.authStore.clear();
      throw err;
    }
    return this.me();
  }

  async me(): Promise<Me> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/me', { ...o, method: 'GET' }));
    const s = r.save as Rec | null;
    return {
      id: str(r.id),
      email: str(r.email),
      verified: r.verified === true,
      nickname: typeof r.nickname === 'string' ? r.nickname : null,
      created: str(r.created),
      save: s ? { revision: int(s.revision), hash: str(s.hash), schema: int(s.schema), updated: str(s.updated) } : null,
      legalNeeds: Array.isArray((r.legal as Rec | undefined)?.needs) ? ((r.legal as Rec).needs as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    };
  }

  logout(): void {
    this.pb.authStore.clear();
  }

  async resendVerification(email: string): Promise<void> {
    await this.call((o) => this.pb.collection('users').requestVerification(normEmail(email), o));
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.call((o) => this.pb.collection('users').requestPasswordReset(normEmail(email), o));
  }

  /** This account's cloud save (null: none yet). The collection rule lets an account read only its own. */
  async getSave(): Promise<CloudSave | null> {
    const list = await this.call((o) => this.pb.collection('saves').getList<Rec>(1, 1, { ...o, sort: '-updated' }));
    return list.items.length ? cloudSaveOf(list.items[0]) : null;
  }

  async putSave(b: PutBody, keepalive = false): Promise<PutResult> {
    const r = await this.call(
      (o) =>
        this.pb.send<Rec>('/api/prime/save', {
          ...o,
          method: 'PUT',
          body: { base: b.base, data: b.text, hash: b.hash, op: b.op, device: b.device, client: APP_VERSION, reason: b.reason, ...this.sessionBody() },
        }),
      keepalive,
    );
    return { revision: int(r.revision), hash: str(r.hash), duplicate: r.duplicate === true, superseded: r.superseded === true, unchanged: r.unchanged === true };
  }

  /** Keep a device version in the account history without making it current. */
  async archive(text: string, hash: string, reason: 'conflict-device' | 'before-restore' | 'session-device', device: string): Promise<void> {
    await this.call((o) => this.pb.send('/api/prime/save/archive', { ...o, method: 'POST', body: { data: text, hash, reason, device, client: APP_VERSION, ...this.sessionBody() } }));
  }

  /** The account's earlier versions, newest first (only its own — collection rule). */
  async history(): Promise<HistoryEntry[]> {
    const list = await this.call((o) => this.pb.collection('save_history').getList<Rec>(1, 20, { ...o, sort: '-created,-revision' }));
    return list.items.map((r) => ({ ...cloudSaveOf(r), created: str(r.created) }));
  }

  async restore(historyId: string, base: number, op: string, device: string): Promise<PutResult> {
    const r = await this.call((o) => this.pb.send<Rec>('/api/prime/save/restore', { ...o, method: 'POST', body: { history: historyId, base, op, device, ...this.sessionBody() } }));
    return { revision: int(r.revision), hash: str(r.hash), duplicate: r.duplicate === true, superseded: false, unchanged: r.unchanged === true };
  }
}
