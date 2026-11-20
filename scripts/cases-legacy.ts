// Beta 2.4 — invitations confirmed BEFORE REWARD CASES (the «legacy» rule, docs/BETA_2_4_DEVELOPMENT_REPORT.md §2):
// a READ-ONLY count over a COPY of the server's data (a verified backup unpacked into its own folder — the folder is
// named explicitly, there is no default, and backend/pb_data is refused).
//
//   npx tsx scripts/cases-legacy.ts <PRIME_DATA_DIR>
//
// The rule: such an invitation stays confirmed and its link stays valid, but REWARD CASES give it nothing by themselves
// (no automatic mass grant). Whether the earlier inviters and friends get a goodwill PRIME INVITE CASE is the owner's
// decision; this report says what that decision would mean (how many cases, how many accounts). If granted, each case
// would carry source «legacy» and the SAME ref a normal grant uses (link:<id>:inviter / link:<id>:invitee), so the
// unique (owner, kind, ref) index makes a second case for one invitation impossible.
//
// Prints counts only — no account ids, nicknames or e-mails. Works on a temporary copy of data.db (and its -wal, if any),
// deleted afterwards — the folder given is never written to.
import { cp, fs, os, path, proc } from './lib/node';

const arg = proc.argv[2];
if (!arg) {
  console.log('usage: npx tsx scripts/cases-legacy.ts <PRIME_DATA_DIR>   (a copy of the data — read only)');
  proc.exit(1);
}
const dir = path.resolve(arg);
const db = path.join(dir, 'data.db');
if (path.resolve('backend/pb_data') === dir) {
  console.log('refused: backend/pb_data is the live local database — point to a copy (an unpacked backup)');
  proc.exit(1);
}
if (!fs.existsSync(db)) {
  console.log(`no data.db in ${dir}`);
  proc.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-legacy-')) as string;
const copy = path.join(tmp, 'data.db');
fs.copyFileSync(db, copy);
if (fs.existsSync(db + '-wal')) fs.copyFileSync(db + '-wal', copy + '-wal');
const q = (sql: string): Record<string, number>[] => {
  const out = cp.execFileSync('sqlite3', ['-json', copy, sql], { encoding: 'utf8' }) as string;
  return out.trim() ? (JSON.parse(out) as Record<string, number>[]) : [];
};
proc.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const hasCases = q("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'prime_cases'")[0].n > 0;
const caseFor = (side: 'inviter' | 'invitee') => (hasCases ? `EXISTS (SELECT 1 FROM prime_cases c WHERE c.kind = 'invite' AND c.ref = 'link:' || l.id || ':${side}')` : '0');
const r = q(`SELECT
  (SELECT count(*) FROM referral_links) AS links,
  (SELECT count(*) FROM referral_links WHERE qualifiedAt > 0) AS confirmed,
  (SELECT count(*) FROM referral_links l WHERE l.qualifiedAt > 0 AND NOT ${caseFor('inviter')}) AS inviterWithout,
  (SELECT count(*) FROM referral_links l WHERE l.qualifiedAt > 0 AND NOT ${caseFor('invitee')}) AS inviteeWithout,
  (SELECT count(DISTINCT l.inviter) FROM referral_links l WHERE l.qualifiedAt > 0 AND NOT ${caseFor('inviter')}) AS inviters,
  (SELECT count(*) FROM referral_links WHERE qualifiedAt = 0) AS pending`)[0];

console.log(`data: ${dir}${hasCases ? '' : '   (no prime_cases yet — a database from before Beta 2.4)'}`);
console.log(`invitation links: ${r.links}  ·  confirmed: ${r.confirmed}  ·  still counting their hour: ${r.pending}`);
console.log(`confirmed without a case — inviter side: ${r.inviterWithout} (${r.inviters} accounts), friend side: ${r.inviteeWithout}`);
console.log(`a goodwill grant (only by the owner's decision) would create ${r.inviterWithout + r.inviteeWithout} PRIME INVITE CASES, source «legacy»`);
console.log(`links still counting get their cases the normal way when the hour is done (${r.pending}) — nothing to do for them`);
console.log('nothing was written');
