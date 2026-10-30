/// <reference path="../pb_data/types.d.ts" />
// PRIME TIME: SHOWDOWN — Alpha 1.9.0 hotfix: PRIME LEAGUE gets its own rate-limit bucket.
//
// Until now every /api/prime/ request of one IP shared 60 a minute — PRIME CLOUD, DAILY, PRIME SHOP and the league
// together. A few honest players behind one home, school or mobile NAT address could hit 429 in the middle of a fight
// (checkpoints, finish, the table). Now a SIGNED-IN request to /api/prime/league/ counts in its own, larger per-IP
// bucket (the aggregate of everyone behind that address); each account is additionally limited on its own inside the
// league routes (lib/league.js) — one flooding account is slowed down alone. Guests stay under the strict /api/prime/
// rule (every league route needs a sign-in anyway). Nothing else changes: registration, sign-in, saves, payments and
// the shop keep their rules.
//
// The client IP is the one the reverse proxy appends (trustedProxy, rightmost X-Forwarded-For — lib/settings.js), so
// a forged header cannot pick a fresh bucket.

const LABEL = '/api/prime/league/';

migrate(
  (app) => {
    const s = app.settings();
    const rules = [{ label: LABEL, audience: '@auth', duration: 60, maxRequests: 180 }];
    // (a Go slice: copied by index, keeping every other rule as it was)
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label === LABEL) continue;
      rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    s.rateLimits.enabled = true;
    app.save(s);
  },
  (app) => {
    const s = app.settings();
    const rules = [];
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label !== LABEL) rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
);
