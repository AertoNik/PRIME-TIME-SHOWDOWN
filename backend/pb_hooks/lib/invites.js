// PRIME TIME: SHOWDOWN — Alpha 1.8.2: PRIME NETWORK invites, administrator side.
// A console command of the PocketBase binary itself — it works on the server's database directly
// (over SSH on a VPS, or through `npm run invites` on the Mac): no administrator token in any
// browser, no public endpoint that creates codes.
//
//   pocketbase invites create [count=1] [days=14] [uses=1] [note=…]   new codes, printed ONCE
//   pocketbase invites list [all]                                     active (or all) invites
//   pocketbase invites stats                                          how many are free / used / expired / revoked
//   pocketbase invites revoke <id|code>                               revoke an unused (or partly used) invite
//
// Only the SHA-256 of a code is stored. A lost code cannot be shown again — create a new one.

const V = require('./validate.js');

function opts(args) {
  const o = { _: [] };
  for (const a of args) {
    const m = /^([a-z]+)=(.*)$/.exec(a);
    if (m) o[m[1]] = m[2];
    else o._.push(a);
  }
  return o;
}

const int = (v, d, min, max) => {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};

function state(r) {
  if (r.getString('revokedAt')) return 'revoked';
  if (r.getInt('uses') >= r.getInt('maxUses')) return 'used';
  const exp = r.getString('expiresAt');
  if (exp && Date.parse(exp.replace(' ', 'T')) <= Date.now()) return 'expired';
  return 'active';
}

const day = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '—');

function create(app, o) {
  const count = int(o._[1] !== undefined ? o._[1] : o.count, 1, 1, 100);
  const days = int(o.days, 14, 0, 365);
  const uses = int(o.uses, 1, 1, 100);
  const note = String(o.note || '').slice(0, 80);
  const col = app.findCollectionByNameOrId('invites');
  const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : '';
  const out = [];
  app.runInTransaction((tx) => {
    for (let i = 0; i < count; i++) {
      // crypto/rand under the hood: 26 symbols of a 32-letter alphabet = 130 bits
      const code = $security.randomStringWithAlphabet(V.INVITE_LENGTH, V.INVITE_ALPHABET);
      const r = new Record(col);
      r.set('codeHash', $security.sha256(V.inviteHashInput(code)));
      r.set('hint', code.slice(-4));
      r.set('note', note);
      r.set('maxUses', uses);
      r.set('uses', 0);
      if (expires) r.set('expiresAt', expires);
      r.set('createdBy', 'console');
      tx.save(r);
      out.push({ id: r.id, code: V.formatInvite(code) });
    }
  });
  console.log('');
  console.log(`PRIME NETWORK — новых приглашений: ${out.length}` + (expires ? ` · действуют до ${day(expires)} UTC` : ' · без срока') + ` · использований на код: ${uses}` + (note ? ` · «${note}»` : ''));
  console.log('Коды показываются ОДИН раз — скопируйте их сейчас. В базе хранится только их хеш.');
  console.log('');
  for (const x of out) console.log(`  ${x.code}    (id ${x.id})`);
  console.log('');
}

function list(app, o) {
  const all = o._[1] === 'all';
  const rows = app.findRecordsByFilter('invites', '', '-created', 500, 0);
  let shown = 0;
  console.log('');
  console.log('id               конец  статус   использ.  истекает (UTC)     создано            заметка');
  for (const r of rows) {
    if (!r) continue;
    const st = state(r);
    if (!all && st !== 'active') continue;
    shown++;
    console.log(`${r.id}  …${(r.getString('hint') + '    ').slice(0, 4)}  ${(st + '        ').slice(0, 8)} ${r.getInt('uses')}/${r.getInt('maxUses')}       ${(day(r.getString('expiresAt')) + '                  ').slice(0, 18)} ${day(r.getString('created'))}   ${r.getString('note')}`);
  }
  if (!shown) console.log(all ? '(приглашений нет)' : '(активных приглашений нет — `invites list all` покажет все)');
  console.log('');
}

function stats(app) {
  const rows = app.findRecordsByFilter('invites', '', '-created', 5000, 0);
  const c = { active: 0, used: 0, expired: 0, revoked: 0 };
  let accounts = 0;
  for (const r of rows) {
    if (!r) continue;
    c[state(r)]++;
    accounts += r.getInt('uses');
  }
  console.log(`PRIME NETWORK приглашения: свободных ${c.active} · использованных ${c.used} · истёкших ${c.expired} · отозванных ${c.revoked} · аккаунтов создано по приглашениям: ${accounts}`);
}

function revoke(app, o) {
  const what = String(o._[1] || '').trim();
  if (!what) throw new Error('укажите id приглашения или сам код: invites revoke <id|код>');
  let r = null;
  try {
    if (/^[a-z0-9]{15}$/.test(what)) r = app.findRecordById('invites', what);
  } catch (_) {
    r = null;
  }
  if (!r) {
    const code = V.normalizeInvite(what);
    if (code) {
      try {
        r = app.findFirstRecordByFilter('invites', 'codeHash = {:h}', { h: $security.sha256(V.inviteHashInput(code)) });
      } catch (_) {
        r = null;
      }
    }
  }
  if (!r) throw new Error('приглашение не найдено');
  const st = state(r);
  if (st === 'revoked') return console.log(`Приглашение ${r.id} уже отозвано.`);
  if (st === 'used') return console.log(`Приглашение ${r.id} уже использовано полностью — отзывать нечего (аккаунт остаётся).`);
  r.set('revokedAt', new Date().toISOString());
  app.save(r);
  console.log(`Приглашение ${r.id} (…${r.getString('hint')}) отозвано: по нему больше нельзя зарегистрироваться.`);
}

/** Entry point of `pocketbase invites …`. */
function cli(app, args) {
  const o = opts(args || []);
  const cmd = o._[0] || 'help';
  try {
    app.findCollectionByNameOrId('invites');
  } catch (_) {
    console.log('Коллекции invites ещё нет: запустите сервер один раз (npm run backend / systemctl start), чтобы применились миграции 1.8.2.');
    return;
  }
  if (cmd === 'create') return create(app, o);
  if (cmd === 'list') return list(app, o);
  if (cmd === 'stats') return stats(app);
  if (cmd === 'revoke') return revoke(app, o);
  console.log('Команды: invites create [N] [days=14] [uses=1] [note=текст] | invites list [all] | invites stats | invites revoke <id|код>');
}

module.exports = { cli: cli, state: state };
