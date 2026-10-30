/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.9.0 «PRIME LEAGUE».
//
//   league_profiles   one row per participant: the season the RP belongs to, RP, hidden MMR, the rank floor, season games,
//                     air points, PRIME TOKENS balance, an open PRIME CHALLENGE, defence on/off, the accepted rules version,
//                     the attacker's league decks (the career's decks stay in the save, untouched).
//   league_defense    Defense Studio: 1–5 slots per participant — a real fighter, its deck, the AI director's tactic, its
//                     look, on/off, a version (a started match keeps its own snapshot), its record.
//   league_matches    every league fight: the server's seed, set and snapshot of both sides, the rules of the fight
//                     (SIM_VERSION), the player's taps, the deadline, the result the SERVER replayed, what it paid.
//                     ONE active match per attacker (a unique partial index — two tabs or devices cannot run two).
//   league_ledger     PRIME TOKENS in and out — one row per reason and reference (a unique index: never paid twice).
//   league_series     PRIME RUSH / PRIME SQUAD / PRIME CHALLENGE progress — one active per participant and kind.
//   league_history    a participant's finished seasons (one row per season).
//   league_rewards    season-track rewards taken (one per season and tier).
//   league_upgrades   fighter levels bought with PRIME TOKENS (one row per participant and fighter).
//
// No collection has an API rule: players read and act only through /api/prime/league/* (lib/league.js, owner = the
// signed-in account). Deleting a PRIME ID deletes its league rows (cascade); other players' fights against its defence
// keep the defender's name as it was. Purely additive: no account, save, consent, order, right or ledger of payments is
// touched. Applied to a real server only together with a separately approved update.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const owner = { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true };
    const base = (name, fields, indexes) =>
      app.save(
        new Collection({
          type: 'base',
          name: name,
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: fields.concat([
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ]),
          indexes: indexes,
        }),
      );
    const int = (name, min, max) => ({ name: name, type: 'number', onlyInt: true, min: min, max: max });

    base(
      'league_profiles',
      [
        owner,
        int('season', 0, 100000),
        int('rp', 0, 1000000),
        { name: 'mmr', type: 'number', min: -100000, max: 100000 },
        int('floor', 0, 1000000),
        int('peak', 0, 1000000),
        int('games', 0, 10000000),
        int('wins', 0, 10000000),
        int('losses', 0, 10000000),
        int('draws', 0, 10000000),
        int('air', 0, 100000000),
        int('tokens', 0, 1000000000),
        { name: 'challenge', type: 'json', maxSize: 2000 },
        { name: 'defenseOn', type: 'bool' },
        int('rules', 0, 1000),
        { name: 'joined', type: 'number', onlyInt: true, min: 0 },
        // lifetime: attack / defence record, best rank, seasons played
        { name: 'stats', type: 'json', maxSize: 4000 },
        // what the player already saw: the last defence report moment, ceremonies shown
        { name: 'seen', type: 'json', maxSize: 4000 },
        // the attacker's league decks per fighter ({ fighter: [4 cards] }) — the career's decks in the save stay untouched
        { name: 'decks', type: 'json', maxSize: 2000 },
        { name: 'nick', type: 'text', max: 16 },
      ],
      ['CREATE UNIQUE INDEX `idx_league_profiles_owner` ON `league_profiles` (`owner`)', 'CREATE INDEX `idx_league_profiles_board` ON `league_profiles` (`season`, `rp`)'],
    );

    base(
      'league_defense',
      [
        owner,
        int('slot', 1, 5),
        { name: 'fighter', type: 'text', required: true, max: 24, pattern: '^[a-z_]+$' },
        { name: 'deck', type: 'json', maxSize: 400 },
        { name: 'tactic', type: 'text', required: true, max: 16, pattern: '^[a-z]+$' },
        { name: 'look', type: 'text', max: 40 },
        { name: 'enabled', type: 'bool' },
        int('version', 0, 100000000),
        int('wins', 0, 10000000),
        int('losses', 0, 10000000),
        int('draws', 0, 10000000),
      ],
      ['CREATE UNIQUE INDEX `idx_league_defense_slot` ON `league_defense` (`owner`, `slot`)', 'CREATE UNIQUE INDEX `idx_league_defense_fighter` ON `league_defense` (`owner`, `fighter`)'],
    );

    base(
      'league_matches',
      [
        { name: 'attacker', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        // the defender's account id as text (no relation: a deleted defender must not delete other players' history)
        { name: 'defOwner', type: 'text', max: 32 },
        { name: 'defKind', type: 'text', max: 8, pattern: '^(player|system)$' },
        { name: 'mode', type: 'text', required: true, max: 12, pattern: '^(duel|challenge|rush|squad)$' },
        { name: 'series', type: 'text', max: 32 },
        int('round', 0, 100),
        int('season', 0, 100000),
        { name: 'sim', type: 'text', required: true, max: 32 },
        { name: 'seed', type: 'number', onlyInt: true, min: 0, max: 4294967295 },
        { name: 'arena', type: 'text', max: 24 },
        { name: 'snapshot', type: 'json', maxSize: 6000 },
        { name: 'status', type: 'text', required: true, max: 8, pattern: '^(active|done|void)$' },
        { name: 'ranked', type: 'bool' },
        { name: 'inputs', type: 'json', maxSize: 16000 },
        { name: 'started', type: 'number', onlyInt: true, min: 0 },
        { name: 'expires', type: 'number', onlyInt: true, min: 0 },
        { name: 'finished', type: 'number', onlyInt: true, min: 0 },
        { name: 'outcome', type: 'text', max: 8 },
        { name: 'method', type: 'text', max: 8 },
        { name: 'result', type: 'json', maxSize: 4000 },
        { name: 'rp', type: 'number', onlyInt: true, min: -10000, max: 10000 },
        int('rpAfter', 0, 1000000),
        { name: 'mmr', type: 'number', min: -10000, max: 10000 },
        int('tokens', 0, 100000),
        int('defTokens', 0, 100000),
        int('air', 0, 100000),
        { name: 'how', type: 'text', max: 16 },
        { name: 'op', type: 'text', max: 64 },
      ],
      [
        "CREATE UNIQUE INDEX `idx_league_matches_active` ON `league_matches` (`attacker`) WHERE `status` = 'active'",
        'CREATE INDEX `idx_league_matches_attacker` ON `league_matches` (`attacker`, `started`)',
        'CREATE INDEX `idx_league_matches_defender` ON `league_matches` (`defOwner`, `finished`)',
        'CREATE INDEX `idx_league_matches_status` ON `league_matches` (`status`, `expires`)',
        'CREATE INDEX `idx_league_matches_op` ON `league_matches` (`attacker`, `op`)',
      ],
    );

    base(
      'league_ledger',
      [owner, { name: 'delta', type: 'number', onlyInt: true, min: -1000000, max: 1000000 }, { name: 'reason', type: 'text', required: true, max: 16, pattern: '^[a-z_]+$' }, { name: 'ref', type: 'text', required: true, max: 80 }, int('balance', 0, 1000000000), int('day', 0, 10000000)],
      ['CREATE UNIQUE INDEX `idx_league_ledger_ref` ON `league_ledger` (`owner`, `reason`, `ref`)', 'CREATE INDEX `idx_league_ledger_day` ON `league_ledger` (`owner`, `reason`, `day`)'],
    );

    base(
      'league_series',
      [owner, { name: 'kind', type: 'text', required: true, max: 12, pattern: '^(rush|squad|challenge)$' }, { name: 'status', type: 'text', required: true, max: 8, pattern: '^(active|done)$' }, int('season', 0, 100000), { name: 'state', type: 'json', maxSize: 8000 }],
      ["CREATE UNIQUE INDEX `idx_league_series_active` ON `league_series` (`owner`, `kind`) WHERE `status` = 'active'", 'CREATE INDEX `idx_league_series_owner` ON `league_series` (`owner`, `created`)'],
    );

    base(
      'league_history',
      [owner, int('season', 0, 100000), int('rp', 0, 1000000), int('peak', 0, 1000000), { name: 'rank', type: 'text', max: 24 }, int('games', 0, 10000000), int('wins', 0, 10000000), int('losses', 0, 10000000), int('draws', 0, 10000000), int('air', 0, 100000000)],
      ['CREATE UNIQUE INDEX `idx_league_history_season` ON `league_history` (`owner`, `season`)'],
    );

    base('league_rewards', [owner, int('season', 0, 100000), int('tier', 1, 100), { name: 'reward', type: 'json', maxSize: 1000 }], ['CREATE UNIQUE INDEX `idx_league_rewards_tier` ON `league_rewards` (`owner`, `season`, `tier`)']);

    base('league_upgrades', [owner, { name: 'fighter', type: 'text', required: true, max: 24, pattern: '^[a-z_]+$' }, int('level', 0, 100)], ['CREATE UNIQUE INDEX `idx_league_upgrades_fighter` ON `league_upgrades` (`owner`, `fighter`)']);
  },
  (app) => {
    for (const name of ['league_upgrades', 'league_rewards', 'league_history', 'league_series', 'league_ledger', 'league_matches', 'league_defense', 'league_profiles']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
