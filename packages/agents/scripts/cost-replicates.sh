#!/bin/sh
# ★ THE EMPTY-CALL RATE IS THE WHOLE RULING, AND ONE ARM CANNOT SETTLE IT.
# W-B returned nothing on 4 of 42 turns against 0 of 41 for the control. 5 against 0 is a
# difference you can get by luck. These replicates alternate control and off, back to back on
# one machine, so the pair is matched on load as well as on seed and cast.
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

run R1-control unset unset
run R1-turnoff off   unset
run R2-control unset unset
run R2-turnoff off   unset
echo REPLICATES DONE
