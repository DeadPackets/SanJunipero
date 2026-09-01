#!/usr/bin/env bash
# SPENDS REAL MONEY: `pnpm rehearse [minutes]`, under the lifetime anomaly stop and a $2 budget
# over a rolling 24 REAL hours — one ceiling over the whole run however fast it runs.
# Two cadences: `rehearse.sh 35` is one full sim-day, night 1 included; `rehearse.sh 70` is the
# two-day launch proof. PORT, SJ_ADMIN_PORT and SJ_LIVE=0 are honoured: two worktrees can rehearse
# at once, and a scripted run proves the wiring for nothing. The admin default clears prod's 8788.
set -u
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1
OUT=$ROOT/rehearsals
# A sim-day is 1440 ticks of 2000 ms: 48 real minutes at SPEED=1. Faster than SPEED=1 puts a
# mind's 4-tick turn gap under the model's 14.7 s p95, so the default buys days with minutes.
MINUTES=${1:-65}
SPEED=${SPEED:-1}
DAYS=$(awk "BEGIN{printf \"%.1f\", $MINUTES * $SPEED / 48}")
export SJ_LIVE=${SJ_LIVE:-1} SJ_FRESH=1 SJ_SPEND_DAILY_USD=2 SJ_MAX_MINDS=8 PORT=${PORT:-8099}
export SJ_MINDS_DIR=$OUT/minds SJ_MODELS_DIR=$ROOT/data/models SJ_ADMIN_TOKEN=rehearsal-$$
export SJ_ADMIN_PORT=${SJ_ADMIN_PORT:-8799}
# Nobody watches a rehearsal, and unwatched is exactly when pacing drops the clock to 0.25x
# after 300 s. Round 2's first launch lost 380 ticks of world B to it before anyone looked.
export SJ_IDLE_PACING=0
# One rotation deep, before SJ_FRESH wipes anything: the run before this one is still readable,
# the one before that is not.
PREV=$ROOT/rehearsals-prev
rm -rf "$PREV"; mkdir -p "$PREV"
[ -d "$OUT" ] && mv "$OUT" "$PREV/rehearsals"
for f in "$ROOT"/data/dev-world.db*; do [ -e "$f" ] && mv "$f" "$PREV/"; done
mkdir -p "$SJ_MINDS_DIR"
# `--env-file` so the key is never on a command line or in the shell's history.
node --env-file="$ROOT/.env" --import tsx packages/town/src/serve.ts > "$OUT/stream.log" 2>&1 &
PID=$!
echo "pid $PID, running $MINUTES min at speed $SPEED — about $DAYS sim-days"
for i in $(seq 1 30); do sleep 2; curl -sf -o /dev/null "http://localhost:$PORT/" && break; done
curl -sf -X POST -H "Authorization: Bearer $SJ_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d "{\"x\":$SPEED}" "http://127.0.0.1:$SJ_ADMIN_PORT/admin/speed" && echo
for i in $(seq 1 $((MINUTES * 6))); do
  sleep 10
  kill -0 $PID 2>/dev/null || { echo "stream exited early at $((i * 10)) s"; break; }
done
kill -INT $PID 2>/dev/null; sleep 5; kill -0 $PID 2>/dev/null && kill $PID
grep -v -i "key" "$OUT/stream.log" | tail -40 > "$OUT/stream-tail.txt"
echo "done; log lines: $(wc -l < "$OUT/stream.log")"
