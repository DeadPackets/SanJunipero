#!/usr/bin/env bash
# One short SJ_LIVE rehearsal. SPENDS REAL MONEY, under the lifetime anomaly stop and a $2 daily
# budget. Writes the log and the mind databases under `rehearsals/`, which is gitignored.
# Usage: pnpm rehearse [minutes]      Then: node --import tsx scripts/score.mjs
# A sim-day is 1440 ticks of 2500 ms: 60 real minutes at SPEED=1. The defaults below cross two sim
# day boundaries, which is the only way a rehearsal sees a night, a dawn and a day rollover. The $2
# budget is a rolling 24 REAL hours, so it is one ceiling over the whole run however fast it runs.
set -u
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
OUT=$ROOT/rehearsals
MINUTES=${1:-30}
SPEED=${SPEED:-4}
DAYS=$(awk "BEGIN{printf \"%.1f\", $MINUTES * $SPEED / 60}")
export SJ_LIVE=1 SJ_FRESH=1 SJ_SPEND_DAILY_USD=2 SJ_MAX_MINDS=8 PORT=${PORT:-8099}
export SJ_MINDS_DIR=$OUT/minds SJ_MODELS_DIR=$ROOT/data/models SJ_ADMIN_TOKEN=rehearsal-$$ SJ_ADMIN_PORT=8788
rm -rf "$SJ_MINDS_DIR"; mkdir -p "$SJ_MINDS_DIR"
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
