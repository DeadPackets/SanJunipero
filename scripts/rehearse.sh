#!/usr/bin/env bash
# One short SJ_LIVE rehearsal. SPENDS REAL MONEY, under the lifetime anomaly stop and a $2 daily
# budget. Writes the log and the mind databases under `rehearsals/`, which is gitignored.
# Usage: pnpm rehearse [minutes]      Then: node --env-file=.env scripts/score.mjs
set -u
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
OUT=$ROOT/rehearsals
MINUTES=${1:-20}
export SJ_LIVE=1 SJ_FRESH=1 SJ_SPEND_DAILY_USD=2 SJ_MAX_MINDS=8 SJ_INTERIORS=1 PORT=${PORT:-8099}
export SJ_MINDS_DIR=$OUT/minds SJ_MODELS_DIR=$ROOT/data/models
rm -rf "$SJ_MINDS_DIR"; mkdir -p "$SJ_MINDS_DIR"
# `--env-file` so the key is never on a command line or in the shell's history.
node --env-file="$ROOT/.env" --import tsx packages/town/src/serve.ts > "$OUT/stream.log" 2>&1 &
PID=$!
echo "pid $PID, running $MINUTES min"
for i in $(seq 1 $((MINUTES * 6))); do
  sleep 10
  kill -0 $PID 2>/dev/null || { echo "stream exited early at $((i * 10)) s"; break; }
done
kill -INT $PID 2>/dev/null; sleep 5; kill -0 $PID 2>/dev/null && kill $PID
grep -v -i "key" "$OUT/stream.log" | tail -40 > "$OUT/stream-tail.txt"
echo "done; log lines: $(wc -l < "$OUT/stream.log")"
