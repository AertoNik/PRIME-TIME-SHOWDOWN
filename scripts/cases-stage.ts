// Beta 2.4 — helper for the ISOLATED scenario (dev only): the real game in a browser against a THROWAWAY server instance
// with an EMPTY database (same code as STAGING), reached through an SSH tunnel on 127.0.0.1:8090. Never STAGING's or
// PRODUCTION's data. Prints no password or token.
//
//   PRIME_REMOTE_API=http://127.0.0.1:8090 PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/cases-stage.ts verify <email>
//   … cases-stage.ts friends <inviter email> <n>   — n TEST friends link the inviter's code and play their verified hour
//   … cases-stage.ts state <email>                 — the account's cases and invitations (counts)
//   … cases-stage.ts host <file>                   — a verified TEST inviter; its email / password go to <file> (mode 600)
import PocketBase from 'pocketbase';
import { registrationExtras } from './lib/backendKit';
import { crypto, fs, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = proc.env.PRIME_REMOTE_API ?? '';
const SU = { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' };
const [cmd, a1, a2] = proc.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !SU.email || !SU.pw || !cmd) {
  console.log('usage: PRIME_REMOTE_API=http://127.0.0.1:<port> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/cases-stage.ts verify|friends|state …');
  proc.exit(1);
}

async function main(): Promise<void> {
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const userBy = async (email: string) => (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
  if (cmd === 'verify') {
    const u = await userBy(a1);
    if (!u) throw new Error('no such account');
    await admin.collection('users').update(u.id, { verified: true });
    console.log(`verified: ${u.nickname ?? u.id}`);
    return;
  }
  if (cmd === 'friends') {
    const host = await userBy(a1);
    if (!host) throw new Error('no such inviter');
    const n = Math.max(1, Math.min(10, Number(a2) || 1));
    const tag = crypto.randomBytes(3).toString('hex');
    for (let i = 0; i < n; i++) {
      const email = `friend${i + 1}-${tag}@isolated.test`;
      const pw = 'Friend2026' + crypto.randomBytes(6).toString('hex');
      const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Friend${i + 1}${tag}`, email, password: pw, passwordConfirm: pw, ...(await registrationExtras(API)) }) });
      if (r.status !== 200) throw new Error(`register friend: ${r.status}`);
      const u = await userBy(email);
      await admin.collection('users').update(u.id, { verified: true });
      const c = new PocketBase(API);
      await c.collection('users').authWithPassword(email, pw);
      const code = (await (await fetch(`${API}/api/prime/referral`, { headers: { Authorization: c.authStore.token } })).json()) as any;
      const hostCode = (await admin.collection('referral_codes').getFullList({ filter: `owner = "${host.id}"` }))[0]?.code;
      if (!hostCode) throw new Error('the inviter has no code yet (open «Пригласить друга» once)');
      const cl = await fetch(`${API}/api/prime/referral/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: c.authStore.token }, body: JSON.stringify({ code: hostCode }) });
      if (cl.status !== 200) throw new Error(`claim: ${cl.status}`);
      void code;
      const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${u.id}"` }))[0];
      // 49 verified PRIME LEAGUE fights × 75 s = 61 min 15 s after the link (the server's own rule decides)
      for (let k = 0; k < 49; k++)
        await admin.collection('league_matches').create({ attacker: u.id, defKind: 'system', mode: 'duel', sim: 'a141348f2a0dea20', seed: 1, status: 'done', ranked: true, inputs: [[10, 0], [200, 1]], started: link.linkedAt + 1000 + k, expires: link.linkedAt + 300000, finished: link.linkedAt + 90000, outcome: 'win', method: 'ko', result: { duration: 75, cardsUsed: 3, steps: 4500 }, how: 'finish' });
      // the friend reads its own invitation once: the server confirms it (and grants the two cases) right there
      await fetch(`${API}/api/prime/referral`, { headers: { Authorization: c.authStore.token } });
    }
    console.log(`${n} test friend(s) linked to the inviter and played their verified hour`);
    return;
  }
  if (cmd === 'host') {
    const tag = crypto.randomBytes(3).toString('hex');
    const email = `host-${tag}@isolated.test`;
    const pw = 'Host2026' + crypto.randomBytes(6).toString('hex');
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `QAHost${tag}`, email, password: pw, passwordConfirm: pw, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register host: ${r.status}`);
    const u = await userBy(email);
    await admin.collection('users').update(u.id, { verified: true });
    fs.writeFileSync(a1, `${email}\n${pw}\nQAHost${tag}\n`, { mode: 0o600 });
    console.log(`test inviter QAHost${tag} registered and verified; its login is in the file`);
    return;
  }
  if (cmd === 'state') {
    const u = await userBy(a1);
    const cases = await admin.collection('prime_cases').getFullList({ filter: `owner = "${u.id}"`, sort: 'openedAt' });
    const links = await admin.collection('referral_links').getFullList({ filter: `inviter = "${u.id}"` });
    console.log(JSON.stringify({ cases: cases.map((c: any) => `${c.kind}${c.tier ? "·T" + c.tier : ""}/${c.source}/${c.status}${c.result?.outcome ? ':' + c.result.outcome + '=' + c.result.amount : ''}`), opsUnique: new Set(cases.filter((c: any) => c.openOp).map((c: any) => c.openOp)).size, invited: links.length, confirmed: links.filter((l: any) => l.qualifiedAt > 0).length }));
    return;
  }
  throw new Error('unknown command');
}

main().catch((e) => {
  console.log('cases-stage: ' + String(e).slice(0, 200));
  proc.exit(1);
});
