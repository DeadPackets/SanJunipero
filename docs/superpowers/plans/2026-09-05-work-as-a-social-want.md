# Work as a social want, and nights that differ

Owner rulings, 2026-09-05: no assigned trades ("aren't we scripting?"); work is a social
aspect, not survival; approved shape: esteem is fed by being useful to somebody, a high esteem
names a road, deeds are mirrored back to self and to others; bedtimes differ and a mind may plan a
night wake. Spec: memory note `goal-2026-09-05-autonomous-v2`, and `needs-are-social-not-survival`.

## Global constraints

- Biome formatting, no Prettier. Comments: default none, cap two lines, only for what code cannot
  show. No em dashes in anything written. Plain modern English in every sentence a mind reads.
- Never read or print `.env`. No live LLM calls in tests. Do not touch `data/`.
- Tests: `npx vitest run <file> --poolOptions.forks.maxForks=2 --silent=true`. Each task ends
  with `npm run -s typecheck`, `npx biome format --write <touched>`, and
  `npx eslint packages/<pkg>/src --quiet` for every touched package.
- Every prompt sentence added must be byte-stable when nothing changed: the system block is the
  only thing the model provider caches, and it caches it whole. Anything that changes per turn
  goes in the volatile messages, never in identity, roster, or personality.
- Events are the log; state changes only through a folded event (`packages/engine/src/fold.ts`).
  A replay must rebuild the same state.
- Measured in the next rehearsal by `scripts/balance.py` (work hours per mind-day, target 3) and
  by `scratchpad/compare.py` (talks, stillborn, cost). Nothing here may raise turns per sim-day:
  no new wake reasons for awake minds.

## Task 1: an item remembers whose hands made it, and the maker is told when it was used

Files: `packages/engine/src/state.ts`, `packages/engine/src/events.def.ts`,
`packages/engine/src/fold.ts`, `packages/engine/src/verbs/index.ts`,
`packages/engine/src/perception.ts`, `packages/agents/src/memory/wants.ts`,
`packages/agents/src/prompt/prose.ts`, tests beside each.

1. `Item` gains `madeBy?: string` (agent id). `ItemSpawned` payload gains `madeBy` optional.
   `fold.ts` copies it like `owner`. The acts that make things stamp it on their spawned items:
   `fish`, `chop`, `forage`, `harvest`, and any craft/cook verb whose `onComplete` spawns an
   item into the actor's hands (search `item_spawned` with `loc: { t: 'agent', id: agentId }`).
   Do not stamp genesis stock or scripted deliveries.
2. A new event `item_used_by_another`, payload `{ agentId, itemId, kind, madeBy, how }` with
   `how` one of `'ate' | 'drank' | 'burned'`. Emitted (in addition to what they emit today) by
   `eat` when the meal's `madeBy` is set and is not the eater; by `stoke` for every fuel item it
   burns whose `madeBy` is set and is not the stoker; by `drink` when the vessel was filled by
   another (only if `fill` can cheaply stamp `madeBy` on refill; if not, leave `drink` out and
   say so in the report). `fold.ts` folds it as a no-op on state (the log is what carries it).
3. Perception: `feltTagFor` matches this event on `payload.madeBy === agentId` (not `agentId`)
   and yields the tag `your_work_used_ate` / `your_work_used_drank` / `your_work_used_burned`.
   Add the three to `FELT_TAGS`. The maker learns it wherever they are; distance is not a
   condition (the town is small and people talk).
4. Prose: `FELT_EVENT_PROSE` gets the three, in plain words without a name, e.g.
   "Somebody ate what you caught or picked." / "Somebody drank from what you filled." /
   "Somebody warmed themselves at a fire you brought the wood for." (`feltEvents` are bare tags;
   do not widen the packet type for a name.)
5. Wants: `FED_BY` gains `relied_on: 'esteem'`; `occasionsInPacket` adds `relied_on` when any
   `your_work_used_*` tag is present.
6. Tests: fold round-trip of `madeBy`; `fish` stamps the catcher; `eat` by another emits the
   event and `eat` by the maker does not; `stoke` emits per burned item; perception yields the
   tag for the maker and nothing for the eater; wants feed esteem on the tag; prose renders all
   three tags (the completeness test over `FELT_TAGS` must stay green).

## Task 2: a high esteem names a road, and an idle mind is told it

Files: `packages/agents/src/prompt/prose.ts`, `packages/agents/src/runtime/bridge.ts`,
`packages/agents/src/runtime/agentRuntime.ts`, tests beside each.

1. `bridge.ts` gains `townStock(): { wood: number; food: number; hearths: number; mouths: number }`
   read off `this.#loop.state`: wood = qty of `wood` items in any store or on any tile (not in
   hands); food = qty of items for which `isFoodKind(config, kind)` holds (`packages/engine/src/food.ts`;
   export it from `@sj/engine` if it is not already) in stores or on tiles; hearths = complete structures with a hearth (see how
   `perception.ts` decides `hearth: 'lit' | 'cold'`); mouths = living, present agents.
2. `prose.ts` gains `usefulLine(want, stock, packet, world)`: returns '' unless `want === 'esteem'`.
   Otherwise: "Today the thing you want most is to be counted on." followed by the short side of
   the town, if any: wood is short when `wood < 2 * hearths` (a hearth burns about two logs a
   night at the live physics); food is short when `food < mouths`. Name the shorter of the two by
   ratio, in plain words: "The town has 3 logs for 5 hearths." or "The town has 7 meals for 12
   mouths." Then the road: who is visibly at that work right now (visible agents whose activity
   is `chop` for wood, `fish`/`forage`/`harvest` for food) by name and place, e.g. "Bashir is
   chopping at (12, 40)."; if nobody, the nearest source via `world.nearestSource` the way
   `coldHearthLine` does. If nothing is short: "Today the thing you want most is to be counted
   on. Nobody is short of anything; who have you not helped lately?" Never a quota, never an
   order.
3. `agentRuntime.ts`: where `wantLine(...)` is placed today at the morning wake, use
   `usefulLine` when the top want is esteem (keep `wantLine` for the other kinds). Also place
   `usefulLine` on a turn whose wake reasons include `boredom` when the top want is esteem, in
   the `now` prose (volatile block), never in the system block.
4. Tests: `townStock` on a small fixture world; `usefulLine` for wood-short, food-short, nothing
   short, and a visible worker vs no worker; runtime places it on morning and boredom only.

## Task 3: deeds are mirrored back, to self and to the town

Files: `packages/shared/src/intent.ts` (RosterEntry), `packages/agents/src/prompt/assemble.ts`,
`packages/agents/src/prompt/prose.ts`, `packages/agents/src/runtime/bridge.ts`,
`packages/agents/src/runtime/agentRuntime.ts`, the roster builder in
`packages/agents/src/live/liveMinds.ts` or wherever `roster()` is composed (follow the import
of `RosterEntry` from `@sj/shared`), tests beside each.

1. Skill buckets, one function in `packages/shared` (next to `RosterEntry`):
   `skillWord(track, xp)`: null under 3 xp, "has taken up <trackVerb>" at 3, "is handy at" at 8,
   "is known for" at 20. Track verbs in plain words: fishing, farming, foraging, carpentry,
   masonry, medicine, scholarship (see `skill: { track: ... }` in `engine/src/verbs/index.ts`).
2. Self: `renderIdentity` gets one line after Backstory when any bucket is non-null:
   "Your hands: fishing you are known for; farming you have taken up." Buckets change rarely, so
   the system block stays cached most of the day. The runtime passes `skills` into the identity
   block from `bridge.agentFacts(agentId).skills` at assembly time (read every turn, rendered in
   buckets).
3. Others: `RosterEntry` gains `knownFor?: string` (the top bucket phrase, e.g. "known for
   fishing"), filled by the roster builder from world skills, and `renderRoster` prints it after
   the name. Same bucket thresholds, so the roster changes rarely.
4. Tests: buckets at the thresholds; identity line renders and is byte-stable across two turns
   with the same buckets; roster renders `knownFor`; a mind with no skills renders exactly as
   before (byte-identical to the current fixture output).

## Task 4: bedtimes differ, and a sleeper may plan a night wake

Files: `packages/agents/src/prompt/assemble.ts` (IdentityCore), `packages/agents/src/wake.ts`,
`packages/agents/src/runtime/agentRuntime.ts`, `packages/agents/src/prompt/rulesOfBeing.ts`,
`packages/agents/src/live/founderMinds.ts`, `packages/agents/src/family/derivePersona.ts`, tests.

1. `IdentityCore` gains `hours?: { rise: number; bed: number }` (hours of the day). Founders get
   them by hand from their backstories (Amara "first one up" rises 5, beds 20; a night owl rises
   9, beds 24; most 6 to 7 and 21 to 22). `derivePersona` picks one of three habits from a stable
   hash of the child's id. `renderIdentity` adds one plain line: "Hours: up around 5, abed by 20."
2. `wake.ts`: the sleeper branch adds `'reconsider'` when `clock.reconsiderAtTick !== null &&
   tick >= clock.reconsiderAtTick` (a planned night wake; the existing `reconsider_at` field
   already accepts a clock time such as 02:30, and `reconsiderTick` wraps to tomorrow). The
   `'morning'` reason additionally requires `packet.time.hour >= riseHour`, where `riseHour` is a
   new `MindConfig` field (default `WAKE_HOUR` from `@sj/shared`), which the runtime sets per
   mind from `identity.hours?.rise`. `isNight` still gates it, so nobody rises before 5.
3. `rulesOfBeing.ts` sleep line adds: "if you mean to be up in the night, say the hour in
   reconsider_at". Keep it one clause.
4. Tests: a sleeper with a due reconsider tick wakes with `reconsider`; a late riser is not
   woken at 06:00 and is at 09:00; identity renders the hours line and is stable; founders each
   have hours; the persona derivation is deterministic.

## Task 5: the chronicle reads what was said, not how many times a type happened

Files: `packages/narrator/src/types.ts` (SceneDigest), `packages/narrator/src/chronicle.ts`
(sceneDigests), a new `packages/narrator/src/moments.ts`, `packages/narrator/src/narrate.ts`,
`packages/narrator/src/llm/narratorLlm.ts` (summarizeChapter prompt), `packages/narrator/src/voice.ts`
(chronicler chapter voice), `packages/narrator/src/publications.ts`, tests beside each.

Measured on r23 and r24: the chapter call sends about 40k input tokens a day, of which the
`eventIds` arrays are nearly all (137k to 153k characters of numbers per day over 6 scenes), and
the model sees nothing else of the day but `typeCounts`, names and a place. The paper therefore
reads "the places held movement, speech, and rest". The town's actual lines are good (see
`agent_spoke` and `scene_line` texts) and the paper never quotes one.

1. `SceneDigest` loses `eventIds` and `typeCounts` and gains `moments: { n: number; text: string }[]`
   where `n` is the event seq (the number the model may cite) and `text` is one plain line. The
   citation validity set in `renderChapter` stays the scene's full `eventIds` (unchanged), so
   dropping the ids from the prompt costs nothing in verification.
2. `moments.ts` exports `pickMoments(evs: SimEvent[], nameOf, cap = 10): { n; text }[]`,
   deterministic, in seq order after selection. Take, in this priority until `cap`:
   a. `scene_closed` with a non-empty `summary` (text: the summary, at most 200 chars);
   b. `agent_died`, `agent_injured`, `agent_collapsed`, `agent_recovered`, `structure_completed`,
      `crop_harvested` (text: `${name} was wounded.` style, use `publicRecordText` where it
      already has the words);
   c. spoken lines from `agent_spoke` and `scene_line`: `sanitizeSpokenText`, keep lines of 30 to
      180 characters, prefer lines that contain a question mark, an exclamation mark, or another
      cast member's name; at most 2 per speaker per scene; text: `${name} said: "${line}"`;
   d. the first `action_completed` per verb among fish, chop, forage, harvest, cook, build,
      plant, mend, carve, teach (text: `${name} was seen to ${verbPhrase(verb)}.`); never walk,
      enter, fill, take, drop, stoke, eat, drink, sleep.
   A day cap of 60 moments across scenes, trimmed from the coolest scenes first (lowest heat).
3. `sceneDigests(scenes, look, events)` builds `moments` from the scene's events via
   `pickMoments`; `narrate.ts` passes `events` through; the `typeCounts` closure in `narrate.ts`
   is removed with its parameter if nothing else uses it.
4. Prompt (`summarizeChapter`): "Each scene lists moments with their numbers. Quote at most one
   line per person, word for word, inside double quotes, and say who said it. Write what
   changed between people, not that people moved and spoke." Chronicler `chapter` voice adds:
   "Quote a line where one is given; a person's own words beat a summary of them." Keep the
   footnote rule and the cast law as they are.
5. `renderNewspaper`: the "Seen in the thick of it" line drops any name that resolved to
   `SOMEONE` (r24 day 0 printed "someone" in the list); if fewer than 2 names remain, omit the
   line.
6. Tests: `pickMoments` priority and caps on a fixture (a death outranks a line; 2 per speaker;
   chores excluded; seq order; day cap trims the coolest scene); the digest has no `eventIds`;
   the prompt text carries the quote instruction; `renderNewspaper` omits `someone`; existing
   narrator tests updated for the digest shape. Byte-size check in a test: a digest for a
   200-event scene serializes under 4,000 characters.

## Task 6: physics that let a town live long enough to want things

Measured on r24 (3.06 sim-days, 12 minds): 6 collapses (4 from energy after skipped nights, 2 from
hunger), 91 meals of which 33 were herbs worth 3 hunger each (Leyla ate herbs hourly from 20:54 to
06:09 and dropped at 06:59 with bread six tiles away), 93 stokes of which 70 fell on day 0 across 9
hearths (a fire already lit takes the log and gains at most the difference), 3 acts of gathering,
and stores bare by day 3 (wood 30 to 0 by the end of day 1; food gone by the end of day 2). The
live hunger rate of 0.03 was set so that "food and wood are work again"; it made bodies drop and
made no work. Work will come from Tasks 1 to 3; this task gives the town time.

Files: `packages/live/src/liveWorld.ts` (LIVE_PHYSICS), `packages/engine/src/verbs/index.ts`
(eat, stoke), tests beside each.

1. `LIVE_PHYSICS`: `needs.hungerDecayPerTick` 0.02 (a meal of 60 lasts two days; twelve mouths
   need about six real meals a day, which five fish and two forages cover), `light.fuelBurnTicks`
   480 (one log a night per hearth; ten hearths want ten logs, five chops). Comment says why.
2. `eat` validates: a herb may be eaten only by a body that is ill, hurt (hp under max) or carrying
   an affliction; otherwise the refusal is "a herb is a remedy, not a meal". The self-relief branch
   in `onComplete` stays. `nutritionOf('herb')` stays as is.
3. `stoke` validates: when the fire has more than half of `fuelBurnTicks` left, refuse with "the
   fire needs nothing yet". The fold's `max` stays.
4. Tests: the LIVE_PHYSICS pair (existing test iterates the table); a well body cannot eat a herb
   and an afflicted one can (update the "an herb is a remedy" test in `verbs.test.ts` to an ailing
   eater); stoke refused on a fresh fire and allowed once half burned.

## Task 7: a perception is remembered short, from the packet, and needs no night call

Measured on r24 (12 minds, 3.06 sim-days): a perception memory row is the whole `now` prose,
1,365 characters on average, and perception rows are 89% of every mind's memory bytes (Leyla:
154 KB of 173 KB after three days). At night `reflection.gist` spends one call per long row to
write a 45% copy beside it: 880 calls in three days, $0.165 a sim-day, 14% of the bill, and the
copy must keep every mark, so it cannot get much shorter. The scenery ("The night sky is clear.
The air is mild.") is what the row is mostly made of, and nothing reads it back. Writing the row
short at the moment it is made removes the night call, cuts memory growth about six-fold, and
shortens the "What you remember" block and the reflection's input, with every mark still there.

Files: `packages/agents/src/prompt/prose.ts` (new `perceptionMemoryText`),
`packages/agents/src/runtime/agentRuntime.ts` (the `insertMemory({ kind: 'perception' })` call),
tests beside each. `packages/agents/src/memory/gist.ts` is untouched: `needsGist` keeps gisting
any long row, so a world resumed with old long rows still gets its short forms.

1. `perceptionMemoryText(packet: PerceptionPacket): string`, deterministic and byte-stable for
   the same packet, in this order and nothing else:
   a. When and where, one sentence: the calendar words of `packet.time` as `calendarLine` says
      them, then "at (x, y)" or "inside <roof> (<structure id>)" when `packet.self.inside` is set
      (use the same `roofSaid` words as `perceptionToProse`).
   b. Company, when any: "With <names>." from `packet.visible.agents` names, in packet order.
   c. Within reach, when any: "Within reach: 2 bread (item_...), 3 herb (item_...)." from the
      same reach items the prose lists as "close enough to touch", marks in full, at most 8, then
      "and N more". Marks are why the row exists: a first gist that paraphrased
      `item_..._bread` as "bread" left the next turn unable to name what it reached (fd5a93e1).
   d. Near, when any: at most 3 visible structures by name with mark, nearest first, as the prose
      says them.
   e. In hand, when any: "In hand: <kinds and marks>."
   No weather, no light, no ground, no affordance sentences, no want or stock lines, no heard
   speech (speech has its own rows).
2. `agentRuntime.ts`: the perception row's `text` becomes `perceptionMemoryText(packet)`; the
   `now` prose the turn reads is unchanged. Importance and tags unchanged.
3. Tests: renders the fixture packet as specified and is byte-identical across two calls; a busy
   packet (12 visible agents, 20 reach items, 6 structures) renders under 700 characters
   (`GIST_MIN_CHARS`), so no gist is ever asked for it; every reach mark in the packet appears
   in the text (up to the cap); the runtime writes the short text and the scene block renders
   the marks; `needsGist` is false for the new row.

## Task 8: the body at a place it already is, and the road to food when none is stored

**Why (r26 mid-run, 2.47 sim-days on 1fd1a8d4):** 77 of 85 walks of no length led to nothing within ten ticks. Farida walked to a fire pit she stood beside 37 times in 22 hours and collapsed at 23:07 still "checking the pit"; Amara 9 times at the same pit, Yusuf 12 and Nadia 6 at the river bank. Each walk came back "You have walked." and a plan_done wake, and the structure line still said "walk to it and you end up beside it". Separately the founding food (41 meals) was gone by day 2 with two casts of fishing in between; on day 2 twelve mouths said "I need actual food" and nothing in the prompt said where food comes from once no meal is stored.

**What:**
- `prose.ts`: a doorless structure the body touches reads "you are beside it now; there is nothing nearer to walk to." (the door fix of b71e132b, for walls with no door).
- `bridge.ts`: `SubmitResult.settled` when the world already held the act (duration 0); `completedSince` returns `settled` and `made` (the kind this body's hands spawned on the same tick); `foodSources` names the nearest bank and wood's edge as footing.
- `agentRuntime.ts`: a settled walk is remembered as "You were already there; no step was needed."; a gathering act says what it came away with, or "nothing"; a plan of nothing but settled steps goes idle instead of waking the mind with plan_done; `foodSources` wired into the prose world; a `trace` sink writes each turn's prose.
- Hunger road: at hunger under 50 with no food in hand and none known, "No food you know of is left in the town. Fish are in the river; the nearest bank to stand on is at (x, y), way. Berries grow at the edge of the woods; the nearest is at (x, y), way." The esteem road (`usefulLine`) falls back to the same sentence when no food is known.
- `LIVE_PHYSICS`: hunger 0.02 -> 0.01 a tick (the schema default): twelve mouths need about three fish a day.
- `SJ_PROSE_TRACE` (compose row, deploy/README row, set by `scripts/rehearse.sh` to `rehearsals/prose.jsonl`): the one record the databases do not keep, so a rehearsal can show whether a line fired and what the mind did with it.

**Not done here:** an `inspect`/`look` act (minds want one: r25 rulings, r26 `inspect_riverbank` x2 and Farida's 40 "checks"); a settled sleep/enter still reads "Nothing needed doing".

## Out of scope, noted for later

Talking while working (a scene opening between two bodies at work without stopping the hands),
a gift of what you made feeding the receiver's affection, and the day log fold threshold.

Queued from r25 (2026-09-06): an invented act ruled by the arbiter still dies on adjacency
(`attempt_beyond_adjacency`, ruling 7 wanted water under the body) instead of sending the body to
the water first; a 2 by 2 storehouse holds two bodies, so a third waits outside for hours; a
mind waiting on somebody to step out of a room is told nothing it could do instead.
