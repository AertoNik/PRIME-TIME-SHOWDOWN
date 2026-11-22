#!/bin/zsh
# The full regression: every check suite of the project, one at a time; one line per suite, then a summary.
#   zsh scripts/regress.sh <log file>      (each suite's whole output goes to <log file>.<suite>.out)
# Suites that start a throwaway PocketBase use their own ports and delete their temporary database.
cd "$(dirname "$0")/.." || exit 1
LOG="${1:-/tmp/prime-regress.log}"
SUITES=(typecheck saves events modes arenas collection anims anim21 boots22 cards music tutorial lucien graveyard primeid accounts shop checkout payments bundles seasonal backend:test beta:test cloud:test public:test upgrade:test daily referral cases league economy:check winter winter:server metrika studio expansion newsroom cardsmenu cardart art20 art22 art23 art24 rewards24 anim25 char23 geo23 hotfix22 ach22 career20 collection20 defense20 combofresh forfeit arenapolish viewport perf255 smartdefense missions profiles hud26 acecard primeshare)
: > "$LOG"
pass=0; fail=0
for s in $SUITES; do
  t0=$(date +%s)
  npm run -s "$s" > "$LOG.$s.out" 2>&1
  rc=$?
  t1=$(date +%s)
  last=$(grep -v '^\s*$' "$LOG.$s.out" | tail -1 | cut -c1-140)
  if [ $rc -eq 0 ]; then pass=$((pass + 1)); echo "PASS $s $((t1 - t0))s $last" >> "$LOG"; else fail=$((fail + 1)); echo "FAIL $s $((t1 - t0))s $last" >> "$LOG"; fi
done
echo "DONE pass=$pass fail=$fail total=${#SUITES}" >> "$LOG"
