#!/bin/sh
# Every arm of the ladder, back to back on one machine, matched on seed, cast, season, tick
# count and pacing. The ONLY thing that varies between them is LADDER_TURN / LADDER_REFL.
set -e
ROOT=/Users/deadpackets/workspace/SanJunipero/.claude/worktrees/agent-a7c0b7cfefcdb02ec
TSX="$ROOT/node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs"
cd "$ROOT"

run() {
  LADDER_LABEL="$1" LADDER_TURN="$2" LADDER_REFL="$3" \
  LADDER_TICKS=420 LADDER_MS_PER_TICK=300 LADDER_CAP=1.5 \
    node --env-file=/Users/deadpackets/workspace/SanJunipero/.env "$TSX" \
    packages/agents/scripts/cost-ladder.ts > "packages/agents/data/ladder/$1.log" 2>&1
  echo "done $1"
}

run W-A2-control unset unset
run W-B-turnoff  off   unset
run W-C-refloff  unset off
run W-D-turnlow  low   unset
run W-E-both     off   off
echo ALL ARMS DONE
