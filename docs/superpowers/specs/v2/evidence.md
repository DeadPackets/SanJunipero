# Live evidence: "drones narrating chores" — measured baseline

Sources (all read-only copies, WAL-safe, queried with `sqlite3 -readonly` and `analyze.py` in this directory):

| world | source | ticks | sim-days | minds | outcome |
|---|---|---|---|---|---|
| **w2** (main baseline) | `~/handoff/backups/town-data-20260902T0823.tgz` | 24,144 | 16.77 | 5 | 4 of 5 died: Nadia d3 (poison), Salma d9 (thirst), Yusuf d10 (thirst), Omar d16 (hunger) |
| **w3** (live, started 09:25 UTC today) | `docker cp` of `dev-world.db` + `minds/*` at 08:57 UTC container time | 984 | 0.68 | 5 | all alive, no deaths yet |
| r3a / r3b | `~/handoff/cleanup/rehearsal6/run-r3{a,b}` | 1,556 / 1,557 | 1.08 each | 5 | rehearsal control |

1 sim-day = 1,440 ticks (`co_slept` day 6 fires at tick 8640). One mind turn ≈ every 21–25 ticks while awake (thought-gap mean 21.6 in w2); every turn writes one `observer_thoughts` row, so thoughts = turns.

Caveats: (a) w3 is 16 sim-hours old, so its culture/director/relationship rows are zero by age, not by failure; (b) the `people/task/wonder` split has two versions — a keyword heuristic over every line (section 2/3 tables) and a bounded LLM pass (deepseek-v4-flash via the repo's `LlmClient`, caller `semantic`, $0.03) over all speech and a 1-in-3 sample of w2 thoughts (section 9); the LLM numbers are the ones to quote; (c) "idle" below means the body had no running action and was not asleep — it is standing between turns.

---

## Headline numbers (the baseline to beat)

### 1. Time budget — where a sim-day goes (share of ticks alive, pooled across minds)

| world | sleep | walk | work (build/chop/craft/forage/fish) | carry/fill/stow | notes (read/write) | eat/drink | tend | custom recipe | speaking tick | **idle standing** |
|---|---|---|---|---|---|---|---|---|---|---|
| w2 (56 mind-days) | 38% | 3% | 3% | 1% | 1% | <1% | <1% | <1% | 2% | **53%** |
| w3 (3.4 mind-days) | 35% | 5% | 0% | 3% | 0% | <1% | 0 | 0 | 3% | **54%** |
| r3a | 47% | 4% | 0% | 1% | 0% | <1% | 0 | 0 | 1% | 47% |
| r3b | 39% | 2% | 7% | 1% | 0% | <1% | 0 | 1% | 1% | 49% |

Per mind per sim-day (w2): 14.9 h awake, of which **12.7 h idle** (85% of awake time), 0.7 h walking, 0.7 h working, 0.5 h reading/writing notes, 0.2 h eating/drinking, 0.02 h tending. w3 so far: 15.7 h awake, 13.0 h idle (83%).

Surplus: every mind has **~12–13 sim-hours a day of nothing**. Nothing in the world claims that time, so it is spent re-perceiving the same room and re-deciding the same chore. Amara (w2) read the same note (`item_66`) 417 times in 16 days = 26 reads/day.

Accepted acts per mind-day (w2): 49.2, of which survival verbs (eat/drink/fill/sleep/wake/stoke/kindle) 18.1 (37%), move/carry 20.5 (42%), making 2.3 (5%), notes 7.8 (16%), social (give/tend/teach) 0.5 (1%), invention 0.07 (0.1%). Engine refusals ("You realize you cannot: …") 13.9 per mind-day = 22% of tries. w3: survival 28.4/day (34%), move/carry 52.4 (62%), making 3.2, social 0.3, invention 0; refusals 16.7/day (17%).

Body pressure w2: 6,583 `hp_changed`, 49 collapses, 50 afflictions, 4 deaths in 16.8 days.

### 2. What they say (agent_spoke)

| metric | w2 | w3 | r3a |
|---|---|---|---|
| lines | 1,546 | 141 | 75 |
| lines per mind-day | 27.6 | 41.3 | 13.9 |
| median words / line | 13 | 11 | 12 |
| addressed to someone by name | 39% | 33% | 45% |
| contains a question | 5% (83) | 10% | 15% |
| is a reply (other speaker ≤30 ticks, ≤8 tiles or same room) | 51% | 71% | 43% |
| reply within 60 ticks | 58% | 80% | 59% |
| verbatim repeat of an earlier line | 13% (204) | 10% | 5% |
| lines inside a 2+-speaker exchange | 50% | 50% | 45% |
| lone lines (nobody within earshot answers within 60 ticks) | 396 of 606 chains | 58 of 81 | 30 of 37 |

Class mix — LLM pass (section 9, all 1,546 w2 lines): **task 53% / people 42% / wonder 5%**; survival is the main concern of 22% of lines; a want beyond needs/work appears in 11%. w3: task 63% / people 35% / wonder 2%, survival 10%, want-beyond 4%. (The keyword heuristic in `tables.md` says 27/51/12 for w2 because any line containing "you" scores "people"; quote the LLM row.) Per mind, w2: Omar is the only voice that is mostly about people (59%); Yusuf is 71% task, 1% want-beyond; Nadia carried the most wonder (14%) and died on day 3. Wonder never exceeds 13% on any sim-day and is 0–4% on 9 of 17 days.

Exchange length (w2, 92 exchanges with 2+ speakers): median 5 lines, 21 of 2 lines, 33 of 8+ lines, max 44. But **the longest alternating run inside an exchange is mostly 2** (40 of 92 exchanges) — lines cluster in time and place without answering each other. The 8+-line exchanges are 33; 11 of those are loops where minds re-say a line already said in that exchange ("First of three." × 5, "Here it is, then. My voice, like I promised." × 4 in one 44-line chain on day 6). 10% of all in-exchange lines are such re-says.

Speech collapses with the cast: w2 lines/day 39, 50, 307, 115, 77, 217, 138, 93, 49, 211, then 23, 20, 15, 26, 69, 52, 45 once only two minds remain (day 10+).

Most repeated w2 lines: "Third one, Omar. Then the last, then I fill the skin for you." ×8; "Come here, you. Just once, let an old man win." ×7; "Rain. Of course. Shoulders of the wall first, they say…" ×7; "Hold still, you." ×6.

### 3. What they think (observer_thoughts = one per turn)

| metric | w2 | w3 | r3a |
|---|---|---|---|
| thoughts | 3,194 | 263 | 190 |
| per mind-day | 57 | 77 | 35 |
| mean words | 42 | 28 | 27 |
| **LLM class task / people / wonder** (w2 = 1-in-3 sample, 1,065) | **58% / 34% / 7%** | 76% / 22% / 2% | 67% / 27% / 6% |
| LLM: survival is the main concern | **53%** | 10% | 13% |
| LLM: want beyond needs/work | 12% | 4% | 3% |
| heuristic class task / people / wonder | 73% / 14% / 11% | 82% / 6% / 9% | 78% / 9% / 12% |
| mentions another person (name or pronoun) | 75% | 68% | 63% |
| want beyond needs/work (wish/hope/curious/want to see…) | **3%** (81) | 1% (2) | 2% |
| contains a question | 0.2% | 0% | 0% |
| survival vocabulary present (hunger/thirst/cold/tired/sleep/food/water/fire/wood) | 83% | 79% | 82% |

The typical thought is an ordered chore list ending in "then bed" (examples below).

### 4. Relationships

| signal | w2 (16.8 d) | w3 (0.7 d) |
|---|---|---|
| co_slept | 3 (Amara+Omar, nights 6–8) | 0 |
| agent_tended | 5 (all Omar→Nadia, day 2) | 0 |
| give actions | 20 | 1 |
| item_owner_changed | 34 | 2 |
| conceived / born / attacks | 0 / 0 / 0 | 0 |
| partnership formed / dissolved / fight event types | **do not exist in the engine** (`reproduction.ts` emits only co_slept, conceived, born; no bond ledger) | — |
| ledgers (private notes on a person) | 17 pairs; only 2 (Amara↔Omar) updated after day 4; the rest frozen at day 2–4 | 0 written yet |
| love/hate/trust/angry words in all ledgers | 17 hits in 17 docs | — |
| nightly reflection calls | 259 (217 ok) → 42 personality edits | — |

The only "love" in w2 is Amara↔Omar: 3 nights co-slept, mutual ledgers at 2,030 and 2,352 chars, and Omar's belief edits ("a shared rule — 'both of us sit, or the fish waits' — can feed you before the food does"). No hate, no break-up, no jealousy anywhere; no mechanism could record one.

### 5. Culture

| signal | w2 | w3 |
|---|---|---|
| arbiter rulings | 62 (3.7/sim-day; 1.1 per mind-day) | 5 |
| …verdict "map" (free text folded back onto an existing verb) | 50 | 4 |
| …verdict "impossible" (`beyond_adjacency`) | 9 | 1 |
| …verdict "attempt" (new recipe written) | 3 | 0 |
| rulebook entries minted | 4: "Sit quietly beside Amara" (d5), expressive verb "sharpen" (d6), "walk toward Omar and the fire pit route" (d9), "hunting spike" (d9) — all still `pending` review | 0 |
| constructs recognized (customs) | 1 unnamed "custom" at (46,51), 2 recurrences, day 2 | 0 |
| codex arrangements known (work rota, common store, food preserving, memorial, bridging) | **0 of 5** | 0 of 5 |
| laws | **0** — no law event type exists; `first_law` milestone at tick 7201 points at a `tick_advanced` row (false positive) | 0 |
| milestones | 19: 10 social (joke, metaphor, speech, conversation, custom, theft, trade, invention, expression, "law") / 9 material | 0 |
| institutions | 12, of which 9 are "N people have slept/woken/walked/read… M times" (noise) | 0 |
| semantic firsts | 2 (joke d0, metaphor d0) | 0 |

Genuine invention attempts in w2 (an intent no verb covers): bare-hand rabbit catch ×6 (3 refused "would need a craft the town has not yet reached", 3 mapped to `hunt` which then refused "you have nothing to hunt with" ×61), whittle a spear ×2 refused on day 6, accepted as "hunting spike" on day 9 (skill roll), sit quietly beside Amara (accepted, 60-tick recipe), sharpen a stick on a grave (expressive). **~10 attempts in 16.8 days across 5 minds ≈ 0.6 per sim-day, 0.12 per mind-day.** Six of the nine refusals were not inventions at all: "wait", "plan give Salma her planks", "recall The bread puzzle…", and a raw JSON turn were all refused with the same canned line "this would need a craft the town has not yet reached". Only 1 intent in w2 and 0 in w3 began with the word `experiment`.

### 6. Director (heat)

91 scenes scored in w2; mean total 15.4. The formula (`narrator/src/heat.ts`) sums per-event weights: `structure_damaged` = 1 each, every speech line past the second = +0.25 "conflict", death = 3.

| rank | day | what the score saw | what actually happened |
|---|---|---|---|
| 1 (127.1) | 10 | conflict 119.5 | a storm: 118 `structure_damaged`, 242 `hp_changed`; 8 lines. Yusuf dragging himself to Omar's door ("Omar. Door. Please.") is in this window, but the score came from the roof tiles |
| 2 (51.2) | 14 | stakes 20, novelty 17 | 5 collapses, 21 sleep verbs; 13 lines |
| 3 (44.3) | 2 | conflict 31 | 123 speech lines (=30 "conflict"), Omar tends Nadia ×3 — the one scene where the score and a human moment agree |
| 5 (39.1) | 6 | conflict 25.5 | the 44-line "First of three" loop (104 lines in window) |

Moments vs heat rank (of 91): Nadia's death rank 13; Salma's death rank 11; Yusuf's death rank 38; Omar's death and all 3 co_slept nights fell in **no scored scene at all**; the sharpen expression and its discovery rank 54; hunting-spike discovery rank 64. So of 15 identifiable moments, 1 is in the top 5 and 4 have no scene. The director rewards volume of events (storms, loops), not change in anyone's life.

### 7. Turn economics

| | w2 | w3 |
|---|---|---|
| turns per mind-day | 57 | 77 |
| acted / spoke / plan_continued | 77% / 49% / 6% | 75% / 51% / 5% |
| turn LLM calls ok | 3,222 of 4,144 (78%) | 265 of 270 |
| rate-limited / timeout / truncated | 775 / 136 / 6 (+241 `llm_output_truncated` alerts) | 2 / 3 / 0 |
| mean input tokens per turn call | 7,368 (51% cache-read) | 8,021 |
| output tokens per turn | 132 | 132 |
| cost | $2.96 for 16.8 days | $0.21 for 0.7 days |

Prompt composition per turn (measured, not assumed): system prefix = CAPABILITIES 1,436 tokens (the verb catalogue) + SPEECH_RULES 464 + RULES_OF_BEING 147 + identity/personality (~400–700) ≈ 2,500 tokens fixed. The volatile "now" prose (perception memories, w2 mean 1,656 chars ≈ 414 tokens): **inventory 36%**, places/structures 16%, other people 13%, own needs 4%, weather/time 5%, rest 25%. Inventory is listed twice per turn ("Your hands hold 1 note (item_131), 1 note (item_132)…" then "You are carrying 1 note (item_131)…" — 12 notes = 24 sentences). The ledgers block ("People here") is 700–2,300 chars per person present, so people prose reaches the model mainly through stale day-2 ledgers, not the scene.

### 8. Survival load vs everything else (per sim-day, w2)

| per mind-day | survival | move/carry | making | notes | social | invention |
|---|---|---|---|---|---|---|
| accepted acts | 18.1 | 20.5 | 2.3 | 7.8 | 0.5 | 0.07 |
| share | 37% | 42% | 5% | 16% | 1% | 0.1% |

Refusals per mind-day 13.9; top reasons "not holding that" 111, "no path to that spot" 100, "collapsed and unable to act" 92, "you have nothing to hunt with" 61, "no one there to attack" 53. Thoughts with survival vocabulary 79%; speech lines 38%. Arbiter reached 1.1 times per mind-day, invention accepted 0.07 per mind-day.

---

## Verbatim examples

### 10 speech lines that typify "drone"

1. w2 d0 Salma: "Right. West it is. The bread can wait; I can't."
2. w2 d0 Omar: "Enough standing around in the dark. Bed."
3. w2 d1 Amara: "Skin filled. Four notes to read, then the tally."
4. w2 d1 Amara: "Fire first. Then nothing."
5. w2 d2 Amara: "Water first. Then the notes. In that order."
6. w2 d2 Nadia: "Water further out than I figured. West it is!"
7. w2 d9 Amara: "Third one, Omar. Then the last, then I fill the skin for you." (said 8 times)
8. w3 d0 Yusuf: "Spot's marked. I need wood, not planks. Back in a bit."
9. w3 d0 Omar: "Fine, fine. Wood first, then you drink something. That's my system."
10. w3 d0 Salma: "Right. Water first, wit after."

### 10 thoughts that typify "drone"

1. w2 t127 Yusuf: "Hearth's cold and I'm cold. Wood first, then bed."
2. w2 t247 Yusuf: "Fire's going. Nine wood is plenty till morning. Bed now."
3. w2 t61 Omar: "Home, fire cold. Wood in, light the hearth, then bed. Herbs can wait for morning light; they keep better than I do."
4. w2 t121 Salma: "In. Walls. Only took all night. Bread, skin, then bed; the herbs can wait for daylight."
5. w2 t360 Salma: "Slept. Dawn. The skin's in hand, bread's in hand, the rest can wait in the corner where I left it. Cold hearth, low clouds. Eat, then out and see what the day is."
6. w2 t512 Omar: "She answered, sort of, and that's enough for now. Fill the skin while the water's at my elbow, then I'll see about breakfast and check the valley's edges."
7. w3 t360 Amara: "Dawn. First one up gets the quiet. Hearth's cold; wood's there. Stoked hearth, then the storehouse tally after."
8. w3 t442 Omar: "At the water at last. Drink first, then fill the skin, then back east to see who's stirring."
9. w3 t448 Omar: "Water at last. Fill the skin, drink, and the morning's settled. No one's needing me yet, or I'd have heard it by now." (turn after #8: same plan re-decided)
10. w3 t455 Amara: "Well's here, water's here, skin's empty. Fill it once, done." — followed 5 ticks later by "Well's beside me and the skin's empty. Fill it while I'm here…"

### 5 that already read as alive

1. w2 d0 Salma (speech): "It's the clouds. They make everybody look like they owe money." — Omar, 2 ticks later: "Clouds and owed money, now that's a valley face if I ever heard one. Eat something before you walk wherever you're walking, Salma."
2. w2 d2 Salma (thought): "He said back before you miss me like it's a joke. It's half a joke. That's the part I don't say."
3. w2 d1 Nadia (thought): "Past the treeline proper now. The wind's different up here, thinner. If the bushes thin out I want to see what replaces them, and my legs are already arguing about which direction."
4. w3 d0 Amara (speech): "Both ends on dirt. Holds. Yusuf, that's good work. I'll say it once." (first praise in world three, at the bridge)
5. w2 night 9, Omar's belief edit (reflection, never spoken aloud): "a shared rule — 'both of us sit, or the fish waits' — can feed you before the food does; hunger argued with alone is sharp…"

Note where the alive text lives: the nightly reflection (personality edits, ledgers) is consistently the best prose in the ledgers — Omar's 14 belief edits read like a novel — and none of it reaches the day's speech, which is generated 57 times a day from an inventory list.

---

## SQL / method

Day length: `select tick, json_extract(payload,'$.day') from events where type='co_slept'` → 8640 = day 6.

Time budget (`analyze.py: time_budget`): per agent, a tick array from 1 to death/end. `agent_slept`→`agent_woke` marks sleep; `action_started` (tick t0, verb) closes at the next `action_completed`/`action_interrupted`/`action_started` for that agent and fills [t0, t1) with the verb's category; `agent_spoke` marks the tick "speak" if otherwise idle; everything else is idle.

```sql
-- verbs and declared durations
select json_extract(payload,'$.verb') v, count(*), sum(json_extract(payload,'$.duration'))
from events where type='action_started' group by v order by 3 desc;
-- speech lines with position
select tick, json_extract(payload,'$.agentId'), json_extract(payload,'$.text'),
       json_extract(payload,'$.x'), json_extract(payload,'$.y'), json_extract(payload,'$.insideId')
from events where type='agent_spoke' order by seq;
-- speech per day and speakers
select tick/1440 day, count(*), count(distinct json_extract(payload,'$.agentId'))
from events where type='agent_spoke' group by 1;
-- turn cadence
with t as (select tick, lag(tick) over (order by tick) p from observer_thoughts where agent_id='omar')
select min(tick-p), avg(tick-p), max(tick-p) from t where p is not null;
-- relationships
select type, count(*) from events where type in ('co_slept','agent_tended','item_owner_changed','agent_conceived','agent_born') group by 1;
select agent_id, person_id, updated_day, length(doc) from ledgers;           -- each minds/<name>.db
-- culture
select json_extract(verdict_json,'$.kind'), json_extract(verdict_json,'$.class'), count(*) from rulings group by 1,2;  -- _arbiter.db
select recipe_id, name, verb, tick, reverted_at_tick from rulebook; select * from constructs; select id, known from codex;
select kind, label, day, tick, tier, domain, agent_ids from milestones order by tick;                       -- _narrator.db
select kind, name, description from institutions; select * from semantic_first_detected;
-- director
select s.id, s.day, s.start_tick, s.end_tick, s."cast", h.conflict, h.novelty, h.firsts, h.stakes, h.total
from heat_scores h join scenes s on s.id=h.scene_id order by h.total desc;
select type, count(*) from events where tick between 14642 and 14882 group by 1 order by 2 desc;         -- top scene window
-- turn economics
select agent_id, count(*), sum(acted), sum(spoke), sum(plan_continued) from turn_outcomes group by 1;    -- _ops.db
select caller, ok, finish_reason, substr(error,1,60), count(*) from llm_calls where caller='turn' group by 1,2,3,4;
select kind, count(*) from alerts group by 1;
-- prompt share: perception memories are the rendered "now" block
select text from memories where kind='perception';   -- split on sentences, bucket by regex (analyze.py section 7)
-- refusals
select text from memories where kind='action' and text like 'You realize you cannot%';
```

Speech classification: regex buckets (task / people / wonder) plus name regex `\b(Amara|Nadia|Omar|Salma|Yusuf)\b` for "addressed by name"; reply = an earlier line by another speaker within N ticks and `dist ≤ 8` (config `movement.earshotRadius` = 8) or same `insideId`; exchange chain = consecutive lines each within 60 ticks and earshot of the previous. LLM pass: `classify.mts` (deepseek-v4-flash on DeepInfra, JSON schema, 40 lines per call).

System-prompt block sizes: `blocks.ts` imports `packages/agents/src/prompt/rulesOfBeing.ts` and prints `length/4`.

---

## Appendix A — LLM classification pass

## 9. LLM classification pass (deepseek-v4-flash, one bounded batch)

Items classified: 3523 of 3,523 submitted (all speech lines of w2/w3/r3a/r3b; every 3rd w2 thought; all w3/r3 thoughts). Spend: $0.032 (91 calls, 170,858 input / 105,220 output tokens, DeepInfra).

| world | kind | n | task | people | wonder | survival is main concern | asks a question | want beyond needs/work |
|---|---|---|---|---|---|---|---|---|
| w2 | speech | 1546 | 53% | 42% | 5% | 22% | 5% | 11% |
| w3 | speech | 141 | 63% | 35% | 2% | 10% | 11% | 4% |
| r3a | speech | 75 | 43% | 45% | 12% | 5% | 21% | 5% |
| r3b | speech | 59 | 44% | 49% | 7% | 5% | 10% | 8% |
| w2 | thoughts | 1065 | 58% | 34% | 7% | 53% | 1% | 12% |
| w3 | thoughts | 263 | 76% | 22% | 2% | 10% | 0% | 4% |
| r3a | thoughts | 190 | 67% | 27% | 6% | 13% | 0% | 3% |
| r3b | thoughts | 184 | 68% | 29% | 3% | 30% | 0% | 7% |

w2 speech by mind (LLM classes):

| mind | n | task | people | wonder | survival | want beyond |
|---|---|---|---|---|---|---|
| amara | 446 | 61% | 34% | 5% | 27% | 13% |
| nadia | 132 | 61% | 25% | 14% | 17% | 14% |
| omar | 586 | 38% | 59% | 4% | 20% | 13% |
| salma | 232 | 56% | 38% | 6% | 24% | 7% |
| yusuf | 150 | 71% | 26% | 3% | 15% | 1% |

w2 speech by sim-day (LLM classes): task / people / wonder

| day | n | task | people | wonder |
|---|---|---|---|---|
| 0 | 39 | 41% | 46% | 13% |
| 1 | 50 | 68% | 30% | 2% |
| 2 | 307 | 46% | 46% | 8% |
| 3 | 115 | 58% | 40% | 2% |
| 4 | 77 | 64% | 32% | 4% |
| 5 | 217 | 45% | 51% | 4% |
| 6 | 138 | 51% | 46% | 3% |
| 7 | 93 | 42% | 48% | 10% |
| 8 | 49 | 57% | 43% | 0% |
| 9 | 211 | 62% | 36% | 2% |
| 10 | 23 | 57% | 39% | 4% |
| 11 | 20 | 55% | 45% | 0% |
| 12 | 15 | 40% | 47% | 13% |
| 13 | 26 | 38% | 42% | 19% |
| 14 | 69 | 55% | 35% | 10% |
| 15 | 52 | 63% | 37% | 0% |
| 16 | 45 | 67% | 22% | 11% |

Speech the LLM tagged wonder + wantBeyond (first 8, w2/w3):

- w2 t493 nadia: "Okay new theory. Soggy ground. Nobody tells you this but bushes love soggy ground. Salma told me, actually, so somebody did tell me. Me. She told me."
- w2 t3383 nadia: "Twelve berries, Salma, count them when we stop! And nobody's walked the ground south of here, I checked, it's all ours to name!"
- w2 t3388 nadia: "Ours to name, Salma, think about that! I name things badly so you'll have to overrule me, it's tradition by now!"
- w2 t3397 nadia: "Salma, keep up! South is the whole point, everything past this grass is unnamed and it's killing me!"
- w2 t3401 nadia: "This is the edge, Salma, everything ahead hasn't got a name yet! I get first look, you get second, that's the deal!"
- w2 t3405 nadia: "Salma, keep up! South is the whole point, everything past this grass is unnamed and it's killing me!"
- w2 t3411 nadia: "New ground! Anything past this line, I saw it first, write it down!"
- w2 t3416 nadia: "South it is. Rain can sulk all it wants, I'm naming something before lunch."

## Appendix B — full generated tables per world (`tables.md`)


## w2: 24144 ticks = 16.77 sim-days

### 1. Time budget (share of ticks alive)

| mind | days alive | sleep | walk | work | logistics | notes | eat/drink | tend | custom | speak | sleep-verb | idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| amara | 16.77 | 37% | 1% | 0% | 1% | 2% | 0% | 0% | 0% | 2% | 0% | 57% |
| nadia | 3.18 | 41% | 4% | 1% | 1% | 0% | 0% | 0% | 0% | 3% | 0% | 50% |
| omar | 16.41 | 40% | 3% | 2% | 1% | 0% | 0% | 0% | 0% | 2% | 0% | 51% |
| salma | 9.20 | 41% | 3% | 3% | 1% | 0% | 0% | 0% | 0% | 2% | 0% | 49% |
| yusuf | 10.52 | 31% | 4% | 11% | 0% | 0% | 0% | 0% | 0% | 1% | 0% | 52% |
| **pooled** | 56.07 | 38% | 3% | 3% | 1% | 1% | 0% | 0% | 0% | 2% | 0% | 53% |

Awake ticks pooled: 50232 (62%). Idle share of awake time: **85%** = 12.7 sim-hours/day per mind (of 14.9 awake). Speaking ticks: 1428.
Collapses: 49; deaths: nadia@d3.2(poison), salma@d9.2(thirst), yusuf@d10.5(thirst), omar@d16.4(hunger)

### 2. Speech

Lines: 1546 (92/day; per mind-day 27.6). Median words 13.0, mean 14.8.
| class | lines | share |
|---|---|---|
| task | 419 | 27% |
| people | 793 | 51% |
| wonder | 190 | 12% |
| other | 144 | 9% |
| questions (any class) | 83 | 5% |
| addressed to someone by name | 605 | 39% |
| reply to another speaker within 30 ticks + earshot | 785 | 51% |
| reply within 60 ticks + earshot | 894 | 58% |
| exact-duplicate lines (line said before, verbatim) | 204 | 13% |
| per mind | omar:586, amara:446, salma:232, yusuf:150, nadia:132 | |

Exchange chains (lines within 60 ticks and earshot of the previous line): 606 total; 92 with 2+ speakers, 118 same-speaker monologue chains of 2+, 396 lone lines.
| 2+-speaker chain length (lines) | count |
|---|---|
| 2 | 21 |
| 3 | 12 |
| 4 | 10 |
| 5 | 7 |
| 6 | 5 |
| 7 | 4 |
| 8 | 9 |
| 9 | 1 |
| 11 | 3 |
| 12 | 2 |
| 13 | 1 |
| 14 | 2 |
| 17 | 3 |
| 18 | 2 |
| 19 | 1 |
| 20 | 1 |
| 23 | 1 |
| 25 | 1 |
| 27 | 1 |
| 31 | 1 |
| 32 | 1 |
| 35 | 1 |
| 39 | 1 |
| 44 | 1 |
| longest alternating run within chain | count |
|---|---|
| 2 | 40 |
| 3 | 12 |
| 4 | 10 |
| 5 | 13 |
| 6 | 5 |
| 7 | 4 |
| 8 | 2 |
| 9 | 3 |
| 11 | 1 |
| 14 | 2 |
Lines inside 2+-speaker chains: 772 = 50% of all speech. Median 2+-speaker chain 5.0 lines, max 44.
Loops: 75 of 772 lines inside 2+-speaker chains (10%) re-say a line already said in that chain (first 25 chars); 12 of 92 chains contain 2+ such repeats. Chains of 8+ lines: 33, of which looping: 11.
Most repeated lines: "Third one, Omar. Then the last, then I fill the skin for you." x8; "Rain. Of course. Shoulders of the wall first, they say. The rain agree" x7; "Come here, you. Just once, let an old man win." x7; "Omar. Fine. What's new is I've walked around with these notes two days" x6; "Hold still, you." x6; "One berry. Slow. That's the whole plan for now." x5

### 3. Thoughts

Thoughts: 3194 (190/day). Mean 42 words, median 40.0.
| class | n | share |
|---|---|---|
| task | 2337 | 73% |
| people | 459 | 14% |
| wonder | 366 | 11% |
| other | 32 | 1% |
| mentions another person (name or pronoun) | 2381 | 75% |
| mentions a want beyond needs/work | 81 | 3% |
| contains a question | 6 | 0% |

### 4. Relationships

co_slept: 3, tended: 5, give actions: 20, item_owner_changed: 34, conceived: 0, born: 0, attacks: 0. (No partnership/dissolution/fight event types exist in the engine.)
| ledger | pairs | last updated day | mean chars | love/hate/trust/angry hits |
|---|---|---|---|---|
| amara | 4 | 10 | 1007 | 6 |
| nadia | 2 | 2 | 504 | 1 |
| omar | 4 | 10 | 1322 | 4 |
| salma | 4 | 4 | 1183 | 3 |
| yusuf | 3 | 4 | 663 | 3 |

### 5. Culture

Rulings: 62 = attempt:3, impossible:9, map:50. Rulebook entries (minted recipes/verbs): 4 -> Sit quietly beside Amara [recipe]; sharpen [express]; walk toward Omar and the fire pit route [recipe]; hunting spike [recipe]. Constructs recognized: 1 -> custom (unnamed) ["nadia","salma","yusuf"] recurrences=2
Codex arrangements known: 0/5 (laws/arrangements reached).
Milestones: 19 (10 social/cultural, 9 material/engine). Social: first_joke@d0, first_metaphor@d0, first_speech@d1, first_conversation@d1, first_custom@d2, first_theft@d2, first_trade@d2, first_law@d5, first_invention@d5, first_expression@d6. Material: first_meal@d1, first_fish@d2, first_death@d3, first_death_poison@d3, first_grave@d3, first_structure@d4, first_house@d4, first_death_thirst@d9, first_fire@d10
Institutions: 12 -> group: Amara & Omar & Salma & Yusuf are often seen together; rule: 4 people have slept 46 times; rule: 3 people have woken 15 times; rule: 3 people have walked 17 times; rule: 4 people have entered 8 times; rule: 2 people have read 43 times; rule: 3 people have exited 6 times; role: Amara has fished 10 times; group: Amara & Omar are often seen together; rule: 2 people have slept 69 times; rule: 2 people have woken 19 times; rule: 2 people have walked 23 times
Semantic firsts: 2 -> joke (omar, d0, 0.95) "She's waved me off twice now, all jokes. Fine."; metaphor (nadia, d0, 0.85) "Salma's building a wall over there, good for her"

### 6. Director (heat)

Scenes scored: 91; total mean 15.4, median 12.6.
| rank | day | ticks | cast | conflict | novelty | firsts | stakes | total | what happened in window |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 10 | 14642-14882 | 3 | 119.5 | 6.1 | 0 | 0 | 127.1 | 8 lines; verbs {'walk': 6, 'wake': 2, 'exit': 1}; nothing notable |
| 2 | 14 | 20161-20401 | 2 | 12.8 | 17.0 | 0 | 20 | 51.2 | 13 lines; verbs {'sleep': 21, 'wake': 9, 'walk': 6, 'exit': 2}; agent_collapsedx5 |
| 3 | 2 | 3604-3844 | 5 | 31.2 | 4.5 | 3 | 4 | 44.3 | 123 lines; verbs {'walk': 64, 'stow': 22, 'read': 22, 'fill': 16}; agent_tendedx3 |
| 4 | 1 | 1682-1922 | 5 | 7.2 | 17.6 | 6 | 9 | 41.3 | 11 lines; verbs {'sleep': 14, 'walk': 14, 'wake': 9, 'exit': 6}; agent_collapsedx2 |
| 5 | 6 | 9123-9363 | 4 | 25.5 | 12.1 | 0 | 0 | 39.1 | 104 lines; verbs {'read': 35, 'walk': 33, 'drink': 5, 'exit': 4}; nothing notable |
| 6 | 7 | 10081-10321 | 4 | 7.0 | 16.0 | 0 | 11 | 35.5 | 2 lines; verbs {'sleep': 6, 'wake': 4, 'walk': 2}; agent_collapsedx3 |
| 7 | 2 | 3363-3603 | 5 | 22.2 | 7.1 | 3 | 0 | 33.8 | 91 lines; verbs {'walk': 69, 'take': 12, 'eat': 10, 'stow': 9}; nothing notable |
| 8 | 13 | 18721-18961 | 2 | 5.5 | 18.0 | 0 | 8 | 33.0 | 8 lines; verbs {'sleep': 11, 'stoke': 9, 'wake': 5, 'walk': 1}; agent_collapsedx2 |

| moment | tick | day | scene heat rank (of 91) | scene total |
|---|---|---|---|---|
| agent_tended nadia | 3837 | 2.7 | 3 | 44.3 |
| agent_tended nadia | 3840 | 2.7 | 3 | 44.3 |
| agent_died nadia | 4578 | 3.2 | 13 | 25.5 |
| discovery_made omar | 7612 | 5.3 | 15 | 24.4 |
| co_slept amara+omar | 8640 | 6.0 | no scene | - |
| discovery_made salma | 9427 | 6.5 | 54 | 11.0 |
| agent_expressed salma | 9431 | 6.5 | 54 | 11.0 |
| co_slept amara+omar | 10080 | 7.0 | no scene | - |
| co_slept amara+omar | 11520 | 8.0 | no scene | - |
| agent_died salma | 13251 | 9.2 | 11 | 29.8 |
| discovery_made amara | 13638 | 9.5 | 14 | 24.6 |
| discovery_made omar | 13978 | 9.7 | 64 | 6.6 |
| fire_ignited + | 14640 | 10.2 | 19 | 23.5 |
| agent_died yusuf | 15145 | 10.5 | 38 | 14.4 |
| agent_died omar | 23629 | 16.4 | no scene | - |

### 7. Turn economics

| mind | turns | turns/day alive | acted | spoke | plan_continued |
|---|---|---|---|---|---|
| amara | 920 | 55 | 85% | 49% | 3% |
| nadia | 219 | 69 | 81% | 65% | 5% |
| omar | 1094 | 67 | 73% | 54% | 4% |
| salma | 523 | 57 | 72% | 44% | 11% |
| yusuf | 438 | 42 | 72% | 35% | 12% |
| **all** | 3194 | 57 | 77% | 49% | 6% |
| turn LLM calls | ok | finish | error | n |
|---|---|---|---|---|
| | 1 | stop |  | 3222 |
| | 0 |  | [Wafer] z-ai/glm-5.3-flash is temporarily rat | 775 |
| | 0 |  | The operation was aborted due to timeout | 136 |
| | 0 | length | No output generated. | 6 |
| | 0 |  | Provider returned error | 4 |
| | 0 | other | No output generated. | 1 |
Turn tokens: input 30532833, cache-read 15571264, output 545872, cost $2.955, calls 4144; mean input/call 7368.
Alerts: llm_call_failed:401, doze_off:362, llm_output_truncated:241, recall_took_the_beat:76, glass_leak:48, reflection_failed:11, adjudicate_failed:3, semantic_firsts_unreadable:2, dream_failed:2, spend_projection:1, reflection_fallback:1

Perception prose (block "now", 3557 turns): mean 1656 chars = ~414 tokens/turn. Share by sentence: inventory 36%, places/structures 16%, other people 13%, own needs 4%, weather/time 5%, rest 25%.

### 8. Invention paths and survival load (per sim-day)

| accepted acts (action_started) | n | per mind-day | share |
|---|---|---|---|
| survival | 1015 | 18.1 | 37% |
| move/carry | 1151 | 20.5 | 42% |
| making | 127 | 2.3 | 5% |
| social | 26 | 0.5 | 1% |
| notes | 437 | 7.8 | 16% |
| invention | 4 | 0.1 | 0% |
| other | 0 | 0.0 | 0% |

Engine refusals ("You realize you cannot"): 781 = 13.9 per mind-day, vs 49.2 accepted acts per mind-day (22% of tries refused). Top reasons: "not holding that" x111; "no path to that spot" x100; "collapsed and unable to act" x92; "you have nothing to hunt with" x61; "no one there to attack" x53; "too far off to reach" x34

Arbiter rulings: 62 = 3.7 per sim-day, 1.11 per mind-day. Verdicts: map:50, impossible:9, attempt:3. Intents that began with the word "experiment": 1.
"map" = the mind wrote free text (or a malformed act) and the court folded it back onto an existing verb; "impossible" = refused; "attempt" = a new recipe was written and rolled.
| ruling | day | intent (trimmed) | verdict |
|---|---|---|---|
| 4 | 1.4 | {thought: Skin's dry still. Fill it, then the notes., importance: 4, action: {name: fill, input | impossible (this would need a craft the town has not yet reached) |
| 5 | 2.1 | wait | impossible (this would need a craft the town has not yet reached) |
| 6 | 2.3 | warm the hearth | map -> kindle |
| 7 | 2.3 | plan Wake, take the 5 wood (item_structure_house_44_51_wood), stow it in Nadia's house, exit, t | map -> take |
| 8 | 2.5 | walk to (12,79), aiming south to find where the land gives out | map -> walk |
| 9 | 2.5 | continue stowing the planks inside the house | map -> stow |
| 11 | 2.5 | Search the riverbank for a stout piece of driftwood or a heavy branch to use as a club | map -> forage |
| 12 | 2.6 | experiment: creep slow and pin the rabbit at (16,40) under both hands, snap its neck quick if I | impossible (this would need a craft the town has not yet reached) |
| 13 | 2.6 | Break a dead branch off the nearest tree and strip it into a heavy club | map -> chop |
| 14 | 2.6 | drop item_93, drop item_94, drop item_95, walk 50 41, keep going south to look for Nadia | map -> drop |
| 15 | 2.6 | read a note by the fire's edge, out of the worst of the rain | map -> read |
| 17 | 3.6 | I lunge to pin the rabbit with my hands, nothing else. | map -> hunt |
| 18 | 3.6 | Try to catch the rabbit at my feet with my bare hands, quick grab and pin | impossible (this would need a craft the town has not yet reached) |
| 19 | 3.6 | plan give Salma her planks and the waterskin | impossible (this would need a craft the town has not yet reached) |
| 25 | 4.5 | I lunge bare-handed for the rabbit at (61,75), trying to pin it under my hands before it bolts. | map -> hunt |
| 26 | 4.5 | Lunge and pin the rabbit at (61,75) with my bare hands, dropping my weight on it | impossible (this would need a craft the town has not yet reached) |
| 27 | 4.5 | I set the lumber down and start raising the frame where I stand, working fast before the light  | map -> build |
| 28 | 4.6 | walk toward the building ground at (58, 46), the town's plot for the new roof | map -> walk |
| 29 | 5.3 | sit down quietly beside Amara, saying nothing, and let her read | attempt |
| 31 | 5.6 | attack fauna_83 | map -> hunt |
| 32 | 5.8 | No weapon but this stick. Fine. Fine. | map -> attack |
| 34 | 6.4 | Sit down across from her, smooth the note flat on my knee, and read item_71 out loud, in my own | map -> read |
| 35 | 6.4 | Sit down and whittle one of the pieces of wood into a sharpened spear point, using a stone to g | impossible (this would need a craft the town has not yet reached) |
| 36 | 6.4 | Whittle one end of a stick of wood into a sharp point, a hunting spear | impossible (this would need a craft the town has not yet reached) |
| 37 | 6.5 | sit down near the hearth, close enough to warm my hands, and let the quiet do its work while sh | map -> sleep |
| 38 | 6.5 | I sit down on my own bed and unfold his note. | map -> read |
| 39 | 6.5 | I kneel at the stone grave marker and scrape the end of my wood against its edge, working it do | map -> express:sharpen |
| 40 | 7.4 | read item_129 (the morning page) while Omar settles by the hearth | map -> read |
| 41 | 7.5 | journal Day 8, morning, storm on the roof. Amara said stay where I'm useful, under this roof, a | map -> write |
| 45 | 9.4 | fill (waterskin) at the river edge, then settle in to watch the bank while Amara fishes. | map -> fill |
| 46 | 9.5 | walk toward Omar and the fire pit route | attempt |
| 47 | 9.5 | stand beside the fire pit with Omar while he eats his fish | map -> speak |
| 48 | 9.6 | I shift the wood higher on my shoulder and turn west, toward the glint of water, letting the wa | map -> walk |
| 49 | 9.6 | stand at the fire pit, waiting for Omar's fish and giving him the count he asked for, straight  | map -> speak |
| 50 | 9.7 | sharpen a length of wood with stone and edge into a hunting spike | attempt |
| 51 | 10.3 | drag myself one tile, toward Omar's doorway at (32,65) | map -> walk |
| 52 | 11.1 | journal Day 12, night. Slept under Nadia's roof, hearth cold, no wood. Dawn order: wood, fire,  | map -> write |
| 53 | 12.5 | recall The bread puzzle keeps. Day 9, her kitchen, saying the page reads better fed. It's kept  | impossible (this would need a craft the town has not yet reached) |
| 56 | 14.1 | drag myself one tile north to (48, 0), toward the rabbit | map -> walk |
| 57 | 14.3 | sleep where I lie at (48,1), in the sun, letting rest do what my pride and my legs cannot | map -> sleep |
| 61 | 15.7 | fish: the water within reach, from where I lie or kneel at (16, 65), x=16, y=65 | map -> fish |
| 62 | 16.4 | drag myself one tile to (46,16), closer to Amara's doorway, and lie there where she can see me | map -> walk |

Minted things: discovery_made 4, agent_expressed 1, structure_inscribed 1, notes written (item_text_changed) 2. Laws: 0 (no law event type exists; codex arrangements all unknown). Customs: constructs above.
Body pressure: hp_changed 6583 (117/mind-day), collapses 49, afflictions 50.
Survival vocabulary (hunger/thirst/cold/tired/sleep/food/water/fire/wood) appears in 83% of thoughts and 38% of speech lines (heuristic; the LLM pass below gives the stricter "main concern" share).

## w3: 984 ticks = 0.68 sim-days

### 1. Time budget (share of ticks alive)

| mind | days alive | sleep | walk | work | logistics | notes | eat/drink | tend | custom | speak | sleep-verb | idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| amara | 0.68 | 37% | 7% | 0% | 4% | 0% | 0% | 0% | 0% | 4% | 0% | 48% |
| nadia | 0.68 | 30% | 2% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 66% |
| omar | 0.68 | 31% | 5% | 0% | 3% | 0% | 1% | 0% | 0% | 3% | 0% | 58% |
| salma | 0.68 | 44% | 8% | 0% | 3% | 0% | 1% | 0% | 0% | 3% | 0% | 42% |
| yusuf | 0.68 | 31% | 3% | 1% | 3% | 0% | 0% | 0% | 0% | 4% | 0% | 57% |
| **pooled** | 3.42 | 35% | 5% | 0% | 3% | 0% | 0% | 0% | 0% | 3% | 0% | 54% |

Awake ticks pooled: 3218 (65%). Idle share of awake time: **83%** = 13.0 sim-hours/day per mind (of 15.7 awake). Speaking ticks: 140.
Collapses: 0; deaths: 

### 2. Speech

Lines: 141 (206/day; per mind-day 41.3). Median words 11, mean 12.1.
| class | lines | share |
|---|---|---|
| task | 40 | 28% |
| people | 66 | 47% |
| wonder | 14 | 10% |
| other | 21 | 15% |
| questions (any class) | 14 | 10% |
| addressed to someone by name | 47 | 33% |
| reply to another speaker within 30 ticks + earshot | 100 | 71% |
| reply within 60 ticks + earshot | 113 | 80% |
| exact-duplicate lines (line said before, verbatim) | 14 | 10% |
| per mind | amara:43, yusuf:37, salma:28, omar:28, nadia:5 | |

Exchange chains (lines within 60 ticks and earshot of the previous line): 81 total; 17 with 2+ speakers, 6 same-speaker monologue chains of 2+, 58 lone lines.
| 2+-speaker chain length (lines) | count |
|---|---|
| 2 | 9 |
| 3 | 4 |
| 5 | 2 |
| 12 | 1 |
| 18 | 1 |
| longest alternating run within chain | count |
|---|---|
| 2 | 12 |
| 3 | 2 |
| 4 | 2 |
| 13 | 1 |
Lines inside 2+-speaker chains: 70 = 50% of all speech. Median 2+-speaker chain 2 lines, max 18.
Loops: 5 of 70 lines inside 2+-speaker chains (7%) re-say a line already said in that chain (first 25 chars); 0 of 17 chains contain 2+ such repeats. Chains of 8+ lines: 2, of which looping: 0.
Most repeated lines: "Yusuf. Planks today, you said. Tomorrow too?" x3; "There. Warmth. You're welcome, town." x3; "Ate. Bread, standing up, like a person with somewhere to be. Your turn" x2; "Oh, a walk, fine. But you carry the talking, my knees do the walking." x2; "Half a heel's not a meal, Salma. And me, I slept crooked and woke with" x2; "Yusuf. Wood's counted. Planks aren't. Cut them, then go west all you l" x2

### 3. Thoughts

Thoughts: 263 (385/day). Mean 28 words, median 27.
| class | n | share |
|---|---|---|
| task | 215 | 82% |
| people | 17 | 6% |
| wonder | 24 | 9% |
| other | 7 | 3% |
| mentions another person (name or pronoun) | 180 | 68% |
| mentions a want beyond needs/work | 2 | 1% |
| contains a question | 0 | 0% |

### 4. Relationships

co_slept: 0, tended: 0, give actions: 1, item_owner_changed: 2, conceived: 0, born: 0, attacks: 0. (No partnership/dissolution/fight event types exist in the engine.)
| ledger | pairs | last updated day | mean chars | love/hate/trust/angry hits |
|---|---|---|---|---|
| amara | 0 | - | - | - |
| nadia | 0 | - | - | - |
| omar | 0 | - | - | - |
| salma | 0 | - | - | - |
| yusuf | 0 | - | - | - |

### 5. Culture

Rulings: 5 = impossible:1, map:4. Rulebook entries (minted recipes/verbs): 0 -> . Constructs recognized: 0
Codex arrangements known: 0/5 (laws/arrangements reached).
Milestones: 0 (0 social/cultural, 0 material/engine). Social: . Material: 
Institutions: 0 -> 
Semantic firsts: 0 -> 

### 6. Director (heat)

Scenes scored: 0; total mean 0.0, median 0.0.
| rank | day | ticks | cast | conflict | novelty | firsts | stakes | total | what happened in window |
|---|---|---|---|---|---|---|---|---|---|

| moment | tick | day | scene heat rank (of 0) | scene total |
|---|---|---|---|---|

### 7. Turn economics

| mind | turns | turns/day alive | acted | spoke | plan_continued |
|---|---|---|---|---|---|
| amara | 75 | 110 | 61% | 52% | 5% |
| nadia | 12 | 18 | 100% | 42% | 0% |
| omar | 47 | 69 | 87% | 55% | 4% |
| salma | 55 | 80 | 80% | 51% | 4% |
| yusuf | 74 | 108 | 72% | 49% | 7% |
| **all** | 263 | 77 | 75% | 51% | 5% |
| turn LLM calls | ok | finish | error | n |
|---|---|---|---|---|
| | 1 | stop |  | 265 |
| | 0 |  | The operation was aborted | 3 |
| | 0 |  | [Wafer] z-ai/glm-5.3-flash is temporarily rat | 2 |
Turn tokens: input 2165560, cache-read 1006208, output 35652, cost $0.214, calls 270; mean input/call 8021.
Alerts: recall_took_the_beat:1, llm_call_failed:1, doze_off:1

Perception prose (block "now", 265 turns): mean 1165 chars = ~291 tokens/turn. Share by sentence: inventory 36%, places/structures 14%, other people 17%, own needs 1%, weather/time 5%, rest 27%.

### 8. Invention paths and survival load (per sim-day)

| accepted acts (action_started) | n | per mind-day | share |
|---|---|---|---|
| survival | 97 | 28.4 | 34% |
| move/carry | 179 | 52.4 | 62% |
| making | 11 | 3.2 | 4% |
| social | 1 | 0.3 | 0% |
| notes | 0 | 0.0 | 0% |
| invention | 0 | 0.0 | 0% |
| other | 0 | 0.0 | 0% |

Engine refusals ("You realize you cannot"): 57 = 16.7 per mind-day, vs 84.3 accepted acts per mind-day (17% of tries refused). Top reasons: "no path to that spot" x15; "both ends must reach something solid" x14; "not holding that" x8; "building needs the thing to raise, and the ground to raise it on" x3; "a bridge belongs over water" x3; "the skin is empty" x2

Arbiter rulings: 5 = 7.3 per sim-day, 1.46 per mind-day. Verdicts: map:4, impossible:1. Intents that began with the word "experiment": 0.
"map" = the mind wrote free text (or a malformed act) and the court folded it back onto an existing verb; "impossible" = refused; "attempt" = a new recipe was written and rolled.
| ruling | day | intent (trimmed) | verdict |
|---|---|---|---|
| 2 | 0.4 | wait | impossible (this would need a craft the town has not yet reached) |
| 5 | 0.6 | enter Amara's house and eat whatever food is there | map -> enter |

Minted things: discovery_made 0, agent_expressed 0, structure_inscribed 0, notes written (item_text_changed) 0. Laws: 0 (no law event type exists; codex arrangements all unknown). Customs: constructs above.
Body pressure: hp_changed 0 (0/mind-day), collapses 0, afflictions 0.
Survival vocabulary (hunger/thirst/cold/tired/sleep/food/water/fire/wood) appears in 79% of thoughts and 38% of speech lines (heuristic; the LLM pass below gives the stricter "main concern" share).

## r3a: 1556 ticks = 1.08 sim-days

### 1. Time budget (share of ticks alive)

| mind | days alive | sleep | walk | work | logistics | notes | eat/drink | tend | custom | speak | sleep-verb | idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| amara | 1.08 | 48% | 1% | 0% | 1% | 0% | 0% | 0% | 0% | 0% | 0% | 48% |
| nadia | 1.08 | 39% | 3% | 2% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 56% |
| omar | 1.08 | 47% | 4% | 0% | 1% | 0% | 0% | 0% | 0% | 1% | 0% | 47% |
| salma | 1.08 | 50% | 3% | 0% | 2% | 0% | 0% | 0% | 0% | 1% | 0% | 42% |
| yusuf | 1.08 | 48% | 9% | 0% | 2% | 0% | 0% | 0% | 0% | 1% | 0% | 40% |
| **pooled** | 5.40 | 47% | 4% | 0% | 1% | 0% | 0% | 0% | 0% | 1% | 0% | 47% |

Awake ticks pooled: 4162 (53%). Idle share of awake time: **87%** = 11.2 sim-hours/day per mind (of 12.8 awake). Speaking ticks: 71.
Collapses: 0; deaths: 

### 2. Speech

Lines: 75 (69/day; per mind-day 13.9). Median words 12, mean 12.5.
| class | lines | share |
|---|---|---|
| task | 17 | 23% |
| people | 44 | 59% |
| wonder | 7 | 9% |
| other | 7 | 9% |
| questions (any class) | 11 | 15% |
| addressed to someone by name | 34 | 45% |
| reply to another speaker within 30 ticks + earshot | 32 | 43% |
| reply within 60 ticks + earshot | 44 | 59% |
| exact-duplicate lines (line said before, verbatim) | 4 | 5% |
| per mind | salma:25, yusuf:22, omar:20, amara:8 | |

Exchange chains (lines within 60 ticks and earshot of the previous line): 37 total; 4 with 2+ speakers, 3 same-speaker monologue chains of 2+, 30 lone lines.
| 2+-speaker chain length (lines) | count |
|---|---|
| 3 | 1 |
| 4 | 1 |
| 13 | 1 |
| 14 | 1 |
| longest alternating run within chain | count |
|---|---|
| 2 | 2 |
| 3 | 2 |
Lines inside 2+-speaker chains: 34 = 45% of all speech. Median 2+-speaker chain 8.5 lines, max 14.
Loops: 1 of 34 lines inside 2+-speaker chains (3%) re-say a line already said in that chain (first 25 chars); 0 of 4 chains contain 2+ such repeats. Chains of 8+ lines: 2, of which looping: 0.
Most repeated lines: "So talk. What's got you hunting me at sunup." x2; "Settled, then. I've bread to put back." x2; "Hm. Wood wants hands, apparently." x2; "Evening, river." x2

### 3. Thoughts

Thoughts: 190 (176/day). Mean 27 words, median 26.0.
| class | n | share |
|---|---|---|
| task | 149 | 78% |
| people | 17 | 9% |
| wonder | 22 | 12% |
| other | 2 | 1% |
| mentions another person (name or pronoun) | 119 | 63% |
| mentions a want beyond needs/work | 4 | 2% |
| contains a question | 0 | 0% |

### 4. Relationships

co_slept: 0, tended: 0, give actions: 0, item_owner_changed: 1, conceived: 0, born: 0, attacks: 0. (No partnership/dissolution/fight event types exist in the engine.)
| ledger | pairs | last updated day | mean chars | love/hate/trust/angry hits |
|---|---|---|---|---|
| amara | 2 | 0 | 711 | 1 |
| nadia | 0 | - | - | - |
| omar | 2 | 0 | 968 | 2 |
| salma | 1 | 0 | 470 | 2 |
| yusuf | 0 | - | - | - |

### 5. Culture

Rulings: 2 = impossible:1, map:1. Rulebook entries (minted recipes/verbs): 0 -> . Constructs recognized: 0
Codex arrangements known: 0/5 (laws/arrangements reached).
Milestones: 5 (2 social/cultural, 3 material/engine). Social: first_speech@d0, first_conversation@d0. Material: first_structure@d0, first_house@d0, first_meal@d0
Institutions: 11 -> group: Amara & Nadia & Omar & Salma & Yusuf are often seen together; rule: 5 people have entered 19 times; rule: 5 people have slept 17 times; rule: 5 people have taken 13 times; rule: 5 people have eaten 9 times; rule: 5 people have woken 9 times; rule: 5 people have exited 16 times; rule: 5 people have walked 82 times; rule: 4 people have filled 45 times; rule: 3 people have drunk 7 times; rule: 3 people have stoked 18 times
Semantic firsts: 0 -> 

### 6. Director (heat)

Scenes scored: 6; total mean 12.2, median 10.8.
| rank | day | ticks | cast | conflict | novelty | firsts | stakes | total | what happened in window |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 1-241 | 6 | 0.0 | 16.0 | 9 | 0 | 25.0 | 0 lines; verbs {'enter': 5, 'sleep': 5, 'take': 3, 'eat': 1}; structure_completedx11 |
| 2 | 0 | 483-723 | 5 | 5.5 | 7.6 | 3 | 0 | 17.6 | 24 lines; verbs {'walk': 29, 'fill': 22, 'stoke': 10, 'exit': 6}; nothing notable |
| 3 | 0 | 242-482 | 5 | 0.0 | 7.6 | 3 | 0 | 12.1 | 1 lines; verbs {'take': 6, 'walk': 6, 'wake': 5, 'eat': 4}; nothing notable |
| 4 | 0 | 724-964 | 5 | 7.0 | 1.0 | 0 | 0 | 9.5 | 30 lines; verbs {'walk': 31, 'fill': 12, 'enter': 2, 'exit': 1}; nothing notable |
| 5 | 0 | 965-1205 | 5 | 4.2 | 1.3 | 0 | 0 | 7.0 | 19 lines; verbs {'walk': 14, 'sleep': 8, 'stoke': 8, 'fill': 6}; nothing notable |
| 6 | 0 | 1206-1439 | 5 | 0.0 | 0.3 | 0 | 0 | 1.8 | 1 lines; verbs {'sleep': 3, 'walk': 2, 'enter': 2, 'fill': 2}; nothing notable |

| moment | tick | day | scene heat rank (of 6) | scene total |
|---|---|---|---|---|

### 7. Turn economics

| mind | turns | turns/day alive | acted | spoke | plan_continued |
|---|---|---|---|---|---|
| amara | 27 | 25 | 85% | 30% | 7% |
| nadia | 16 | 15 | 100% | 0% | 0% |
| omar | 40 | 37 | 80% | 50% | 2% |
| salma | 54 | 50 | 72% | 46% | 17% |
| yusuf | 53 | 49 | 74% | 42% | 9% |
| **all** | 190 | 35 | 78% | 39% | 9% |
| turn LLM calls | ok | finish | error | n |
|---|---|---|---|---|
| | 1 | stop |  | 190 |
| | 0 |  | [Wafer] z-ai/glm-5.3-flash is temporarily rat | 99 |
| | 0 |  | The operation was aborted due to timeout | 2 |
Turn tokens: input 1393048, cache-read 736960, output 23959, cost $0.131, calls 291; mean input/call 4787.
Alerts: llm_call_failed:43, doze_off:37, llm_dead_calls:6, reflection_failed:5, llm_provider_mix:3, glass_leak:3, recall_took_the_beat:2, adjudicate_failed:1

Perception prose (block "now", 227 turns): mean 1116 chars = ~279 tokens/turn. Share by sentence: inventory 33%, places/structures 23%, other people 6%, own needs 2%, weather/time 7%, rest 30%.

### 8. Invention paths and survival load (per sim-day)

| accepted acts (action_started) | n | per mind-day | share |
|---|---|---|---|
| survival | 105 | 19.4 | 43% |
| move/carry | 132 | 24.4 | 54% |
| making | 2 | 0.4 | 1% |
| social | 0 | 0.0 | 0% |
| notes | 6 | 1.1 | 2% |
| invention | 0 | 0.0 | 0% |
| other | 0 | 0.0 | 0% |

Engine refusals ("You realize you cannot"): 25 = 4.6 per mind-day, vs 45.3 accepted acts per mind-day (9% of tries refused). Top reasons: "not enough wood — wood comes from felling a tree" x5; "no path to that spot" x4; "you reach for it and find only the word, with no act behind it" x3; "the world ends that way" x3; "speaking needs words to say" x2; "not holding that" x2

Arbiter rulings: 2 = 1.9 per sim-day, 0.37 per mind-day. Verdicts: impossible:1, map:1. Intents that began with the word "experiment": 0.
"map" = the mind wrote free text (or a malformed act) and the court folded it back onto an existing verb; "impossible" = refused; "attempt" = a new recipe was written and rolled.
| ruling | day | intent (trimmed) | verdict |
|---|---|---|---|
| 1 | 0.4 | journal Day one. Salma took ten wood from the cottage pile. Marked here, so it is counted. Fire | impossible (The intent is to write a journal entry, but write needs an item in hand to write on, and Amara carries only bread and a waterskin — nothing that holds ink or char. With no surface to mark, the first step cannot be taken.) |
| 2 | 0.4 | journal Storehouse, day one: 9 berries, 6 bread, 2 charcoal, 6 clay, 5 cloth, 7 fiber, 4 fish,  | map -> write |

Minted things: discovery_made 0, agent_expressed 0, structure_inscribed 0, notes written (item_text_changed) 2. Laws: 0 (no law event type exists; codex arrangements all unknown). Customs: constructs above.
Body pressure: hp_changed 0 (0/mind-day), collapses 0, afflictions 0.
Survival vocabulary (hunger/thirst/cold/tired/sleep/food/water/fire/wood) appears in 82% of thoughts and 45% of speech lines (heuristic; the LLM pass below gives the stricter "main concern" share).

## r3b: 1557 ticks = 1.08 sim-days

### 1. Time budget (share of ticks alive)

| mind | days alive | sleep | walk | work | logistics | notes | eat/drink | tend | custom | speak | sleep-verb | idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| amara | 1.08 | 51% | 0% | 0% | 1% | 0% | 0% | 0% | 0% | 0% | 0% | 47% |
| nadia | 1.08 | 55% | 5% | 0% | 1% | 0% | 0% | 0% | 0% | 1% | 0% | 39% |
| omar | 1.08 | 44% | 2% | 0% | 1% | 0% | 0% | 0% | 4% | 1% | 0% | 49% |
| salma | 1.08 | 24% | 2% | 0% | 2% | 0% | 0% | 0% | 0% | 1% | 0% | 70% |
| yusuf | 1.08 | 22% | 3% | 32% | 1% | 0% | 0% | 0% | 0% | 0% | 0% | 41% |
| **pooled** | 5.41 | 39% | 2% | 7% | 1% | 0% | 0% | 0% | 1% | 1% | 0% | 49% |

Awake ticks pooled: 4745 (61%). Idle share of awake time: **81%** = 11.8 sim-hours/day per mind (of 14.6 awake). Speaking ticks: 58.
Collapses: 0; deaths: 

### 2. Speech

Lines: 59 (55/day; per mind-day 10.9). Median words 11, mean 11.7.
| class | lines | share |
|---|---|---|
| task | 18 | 31% |
| people | 31 | 53% |
| wonder | 2 | 3% |
| other | 8 | 14% |
| questions (any class) | 7 | 12% |
| addressed to someone by name | 29 | 49% |
| reply to another speaker within 30 ticks + earshot | 29 | 49% |
| reply within 60 ticks + earshot | 31 | 53% |
| exact-duplicate lines (line said before, verbatim) | 5 | 8% |
| per mind | salma:21, omar:17, nadia:13, yusuf:7, amara:1 | |

Exchange chains (lines within 60 ticks and earshot of the previous line): 32 total; 4 with 2+ speakers, 2 same-speaker monologue chains of 2+, 26 lone lines.
| 2+-speaker chain length (lines) | count |
|---|---|
| 2 | 1 |
| 3 | 1 |
| 8 | 1 |
| 16 | 1 |
| longest alternating run within chain | count |
|---|---|
| 2 | 2 |
| 3 | 1 |
| 11 | 1 |
Lines inside 2+-speaker chains: 29 = 49% of all speech. Median 2+-speaker chain 5.5 lines, max 16.
Loops: 3 of 29 lines inside 2+-speaker chains (10%) re-say a line already said in that chain (first 25 chars); 0 of 4 chains contain 2+ such repeats. Chains of 8+ lines: 2, of which looping: 0.
Most repeated lines: "The cold. It's a very interesting cold." x2; "Salma. Look at me a second. You slept, or you didn't? One word's all." x2; "A week, then. I'll hold you to the week, Salma." x2; "Enjoy the herbs, Omar. Try not to name any." x2; "Salma! Patch was real, I'm dropping your half off before I lose my ner" x2

### 3. Thoughts

Thoughts: 184 (170/day). Mean 28 words, median 27.0.
| class | n | share |
|---|---|---|
| task | 145 | 79% |
| people | 14 | 8% |
| wonder | 22 | 12% |
| other | 3 | 2% |
| mentions another person (name or pronoun) | 119 | 65% |
| mentions a want beyond needs/work | 1 | 1% |
| contains a question | 1 | 1% |

### 4. Relationships

co_slept: 0, tended: 0, give actions: 0, item_owner_changed: 3, conceived: 0, born: 0, attacks: 0. (No partnership/dissolution/fight event types exist in the engine.)
| ledger | pairs | last updated day | mean chars | love/hate/trust/angry hits |
|---|---|---|---|---|
| amara | 0 | - | - | - |
| nadia | 2 | 0 | 670 | 3 |
| omar | 0 | - | - | - |
| salma | 0 | - | - | - |
| yusuf | 0 | - | - | - |

### 5. Culture

Rulings: 3 = attempt:1, impossible:1, map:1. Rulebook entries (minted recipes/verbs): 1 -> wait by the fire [recipe]. Constructs recognized: 0
Codex arrangements known: 0/5 (laws/arrangements reached).
Milestones: 7 (4 social/cultural, 3 material/engine). Social: first_law@d0, first_speech@d0, first_conversation@d0, first_invention@d0. Material: first_structure@d0, first_house@d0, first_meal@d0
Institutions: 11 -> role: Nadia has foraged 5 times; group: Amara & Nadia & Omar & Salma & Yusuf are often seen together; rule: 5 people have entered 20 times; rule: 5 people have taken 19 times; rule: 5 people have slept 18 times; rule: 4 people have eaten 12 times; rule: 4 people have stoked 7 times; rule: 5 people have woken 8 times; rule: 5 people have exited 12 times; rule: 5 people have walked 70 times; rule: 2 people have filled 28 times
Semantic firsts: 0 -> 

### 6. Director (heat)

Scenes scored: 6; total mean 12.7, median 10.2.
| rank | day | ticks | cast | conflict | novelty | firsts | stakes | total | what happened in window |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 1-241 | 6 | 0.0 | 16.0 | 12 | 0 | 28.0 | 0 lines; verbs {'enter': 6, 'take': 3, 'sleep': 3, 'eat': 2}; structure_completedx11 |
| 2 | 0 | 483-723 | 5 | 10.2 | 7.7 | 3 | 0 | 22.5 | 43 lines; verbs {'walk': 35, 'fill': 21, 'take': 5, 'enter': 4}; discovery_madex1 |
| 3 | 0 | 242-482 | 5 | 0.2 | 7.7 | 6 | 0 | 15.5 | 3 lines; verbs {'walk': 10, 'take': 7, 'eat': 5, 'exit': 4}; nothing notable |
| 4 | 0 | 965-1205 | 5 | 1.5 | 2.0 | 0 | 0 | 5.0 | 8 lines; verbs {'walk': 17, 'sleep': 8, 'enter': 7, 'drop': 5}; nothing notable |
| 5 | 0 | 724-964 | 5 | 0.8 | 2.4 | 0 | 0 | 4.6 | 5 lines; verbs {'walk': 8, 'fill': 5, 'forage': 3, 'read': 2}; structure_completedx1 |
| 6 | 0 | 1206-1439 | 5 | 0.0 | 0.5 | 0 | 0 | 0.5 | 0 lines; verbs {'sleep': 4, 'enter': 3, 'wake': 1, 'exit': 1}; structure_completedx1 |

| moment | tick | day | scene heat rank (of 6) | scene total |
|---|---|---|---|---|
| discovery_made omar | 619 | 0.4 | 2 | 22.5 |

### 7. Turn economics

| mind | turns | turns/day alive | acted | spoke | plan_continued |
|---|---|---|---|---|---|
| amara | 15 | 14 | 100% | 7% | 0% |
| nadia | 29 | 27 | 86% | 45% | 3% |
| omar | 47 | 43 | 66% | 38% | 4% |
| salma | 52 | 48 | 90% | 38% | 0% |
| yusuf | 41 | 38 | 56% | 17% | 32% |
| **all** | 184 | 34 | 77% | 32% | 9% |
| turn LLM calls | ok | finish | error | n |
|---|---|---|---|---|
| | 1 | stop |  | 184 |
| | 0 |  | [Wafer] z-ai/glm-5.3-flash is temporarily rat | 69 |
Turn tokens: input 1259214, cache-read 601024, output 22610, cost $0.127, calls 253; mean input/call 4977.
Alerts: llm_call_failed:23, doze_off:19, llm_dead_calls:7, reflection_failed:4, recall_took_the_beat:4, llm_provider_mix:4, glass_leak:3, llm_output_truncated:1

Perception prose (block "now", 203 turns): mean 1126 chars = ~281 tokens/turn. Share by sentence: inventory 37%, places/structures 23%, other people 6%, own needs 1%, weather/time 6%, rest 27%.

### 8. Invention paths and survival load (per sim-day)

| accepted acts (action_started) | n | per mind-day | share |
|---|---|---|---|
| survival | 75 | 13.9 | 34% |
| move/carry | 127 | 23.5 | 58% |
| making | 10 | 1.8 | 5% |
| social | 0 | 0.0 | 0% |
| notes | 7 | 1.3 | 3% |
| invention | 1 | 0.2 | 0% |
| other | 0 | 0.0 | 0% |

Engine refusals ("You realize you cannot"): 24 = 4.4 per mind-day, vs 40.7 accepted acts per mind-day (10% of tries refused). Top reasons: "no path to that spot" x6; "no forest nearby — berries, mushrooms and herbs grow in patches, and a" x3; "the town keeps ground for a house — go and stand at (51, 46)" x3; "there is nothing over you here; find somewhere to lie down — weary eno" x2; "the world ends that way" x2; "you are indoors; step outside first" x2

Arbiter rulings: 3 = 2.8 per sim-day, 0.55 per mind-day. Verdicts: map:1, impossible:1, attempt:1. Intents that began with the word "experiment": 0.
"map" = the mind wrote free text (or a malformed act) and the court folded it back onto an existing verb; "impossible" = refused; "attempt" = a new recipe was written and rolled.
| ruling | day | intent (trimmed) | verdict |
|---|---|---|---|
| 2 | 0.4 | journal Day 1, morning. Storehouse counted: bread 6, berries 9, charcoal 2, clay 6, cloth 5, fi | impossible (this would need a craft the town has not yet reached) |
| 3 | 0.4 | wait | attempt |

Minted things: discovery_made 1, agent_expressed 0, structure_inscribed 0, notes written (item_text_changed) 0. Laws: 0 (no law event type exists; codex arrangements all unknown). Customs: constructs above.
Body pressure: hp_changed 0 (0/mind-day), collapses 0, afflictions 0.
Survival vocabulary (hunger/thirst/cold/tired/sleep/food/water/fire/wood) appears in 71% of thoughts and 27% of speech lines (heuristic; the LLM pass below gives the stricter "main concern" share).