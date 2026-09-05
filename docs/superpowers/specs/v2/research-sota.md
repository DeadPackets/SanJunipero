# State of the art: emergent, watchable social life in LLM towns

Verdict up front: **the sources agree on one loop** — slow numeric social state (needs, closeness, status, stress) gates *whether* an LLM call happens; the call is then a committed *scene* with wants in conflict, not a per-tick decision; the outcome is written back as numbers and as a memory that later retrieval, reflection and a director can find. The town today (independent per-tick turns, 51% speaking, plank-thoughts) is the ablated condition every paper measured as worst.

## (a) Mechanisms that reliably produce watchable social life

| # | Mechanism | Shown by | Data shape / loop it implies |
|---|---|---|---|
| 1 | **Memory stream + importance-weighted retrieval + reflection tree** | Park 2023 [1]: score = recency(0.995^hours) + importance(LLM 1–10) + relevance(cosine), equal weights; reflect when Σimportance of recent events > 150 (~2–3×/day): 3 salient questions → 5 insights each citing evidence. Ablation TrueSkill: full 29.89, no-reflection 26.88, no-memory 21.21, human crowdworkers 22.95 | `memory{text, ts, last_access, importance, embedding, kind, cites[]}`; reflections are memories with children |
| 2 | **Intentions that must travel through other people** | Park 2023 [1]: one seed ("Isabella wants a Valentine's party") → 12/25 heard, 5 attended, 3 declined with reasons; Sam's candidacy 1→8 agents | A plan is a memory the owner re-retrieves before every talk; spreading is gossip, attendance is a scheduled meet |
| 3 | **Conversation as a committed option with an exit test** | Lyfe Agents [2]: `talk` option persists until time cap or semantic-repetition exit; ablated agents left 3× sooner; $0.50/agent-hour vs ~$25 for Park. AI Town [3]: 8 messages max, 2 min in prod, 80% invite accept, 15 s cooldown, 20 s "awkward" timeout. Humanoid [4]: 10 turns; turns vs closeness is inverse-U | `scene{participants, wants[], budget_turns, exit_when}`; one LLM turn per utterance, no wander logic inside |
| 4 | **Slow numeric state that gates and colours** | Humanoid Agents [4]: 5 needs 0–10, replan only when ≤3 or emotion ≠ neutral; closeness 0–30, ±1 per conversation as judged. Sims [5]: motives −100..100, object "advertisement" × need multiplier × personality × distance, pick randomly from top-N. Sims 2 [6]: daily relationship −2/day at 4 pm; lifetime drifts toward daily 3 pts/8 h. Sentipolis [7]: valence/arousal with exponential decay | `edge{a,b, daily, lifetime, last_seen}`; `mind{needs, mood, stress}`; LLM sees the words for these numbers, never the numbers |
| 5 | **Social awareness: a model of what others feel about me** | Project Sid/PIANO [8]: agents track others' sentiment (Lila's likeability 8→2→8), infer peer likeability r=0.807; **unrequited feelings emerged**; ablating the module flattened relationships (slope 0.159 vs 0.373) and killed role diversity | per-agent `belief_about[other]{likes_me, wants}` updated after every scene |
| 6 | **One decision bottleneck across concurrent modules** | PIANO [8]: 10 modules run at different rates; a Cognitive Controller is the single writer so speech and action stop contradicting | Perception/reflection async; exactly one place emits `{say, do}` |
| 7 | **Personality that costs something to betray** | CK3 [9]: acting against traits adds stress; mental break at 100/200/300, coping traits at 20% each; DF [10]: memories re-felt with their emotion. Artificial Leviathan [11]: prompted traits correlate *weakly* with behaviour — enforce mechanically | `trait → stress_delta(action)`; stress is a director signal |
| 8 | **Institutions as editable shared artifacts** | Sid [8]: 29 agents, 20% base tax, feedback→amend→vote→new constitution at 600 s; 3 influencers moved compliance both ways. Emergence World [12]: 10 agents, 15 days; constitutional growth, agent-authored tools. Naming game [13]: conventions emerge in 24–200 agents; committed minority needed to flip: 2% (Llama-3) to 21% (Claude 3.5) | `law{text, proposer, votes, enforced_by, since}` in the world, not in prompts |
| 9 | **Gaps the viewer fills, plus a legible record** | Sims [5]: "if we used actual language the game would flatten"; DF [10]: "write the stories first, then find the gaps in mechanics"; descriptions that make it into player stories get made mechanical | Log every scene as a one-line chronicle entry with Δrelationship |
| 10 | **A director on an intensity curve** | L4D [14]: per-survivor intensity, build→peak→relax (relax 30–45 s, mobs every 90–180 s), "structured unpredictability", layered simple algorithms. Façade [15]: ~27 beats with preconditions + tension effect, chosen to fit the arc; story values affinity/tension. RimWorld [16]: Cassandra = tension curve with breathers. SHOW-1 [17]: sim runs 24/7, weekly highlight episode, 14 scenes/22 min | see (d) |

## (b) Failure modes and how sources mitigated them

- **Drones / everyone agrees.** Park [1]: instruction tuning → formal speech, agents "rarely refuse". Sid [18]: "endless loops of polite agreement". Pluralistic ignorance [19]: 64–94% public conformity against private belief across 8 models; dissent cascades succeed <26%. LLM dating [20]: no linguistic convergence, alignment suppresses differentiation. *Mitigations:* peer-credibility signals cut sycophancy 20%→10% [21]; SOTOPIA-hard [22] is exactly the goal-conflict subset — give each scene opposed wants; Johnstone [23]: play status as a seesaw, every line raises or lowers; enforce refusal with numbers (closeness<5 ⇒ decline).
- **Repetition.** AGA [24]: behaviours in a fixed world saturate (finite set); diversity falls over long runs, and the *memory* block is the strongest homogeniser [25]; Showrunner's "10,000 bowls of oatmeal" [17]. *Mitigations:* Lyfe's repetition exit [2]; exogenous shocks (RimWorld/CK3 events); a newcomer crashed GovSim equality 94→31 [26] — a story, not a bug.
- **Hallucinated relationships / embellishment.** Park [1]: Isabella invented "an announcement tomorrow"; Sid [8]: small hallucination rates poison groups. *Mitigations:* Concordia's Game Master is the sole author of event statements [27]; AGA's Social Memory keeps relationship as ~100 explicit tokens [24]; closeness is a number the model reads, never asserts.
- **Cost blow-up.** Park: "thousands of dollars" for 25 agents × 2 game days on gpt-3.5 [1]; Lyfe 10–100× cheaper via options + summarize-and-forget [2]; AGA 31–43% of baseline tokens via lifestyle-policy cache at 0.97 similarity [24]; AI Town's hard caps [3].
- **Incoherence / unreachable goals.** Sid: intent≠action fixed by the bottleneck; agents "chasing unattainable goals" needed intervention [18]; Voyager [28] only adds a skill after self-verification.

## (c) Survival pressure vs surplus

Scarcity yields an *arc*, surplus yields *culture*. Artificial Leviathan [11]: 9 agents, 1 food/day → robbery, then protection pacts, then a sovereign and a farming/trading commonwealth; conflict stopped once pressure eased. GovSim [26]: only GPT-4o kept a commons alive (53%); removing talk raised overuse 22%; negotiation was 62% of dialogue. Sid [8]: memes formed in dense towns, not the sparse countryside, and the paper admits agents "lack innate drives (survival, curiosity, community)". Humanoid [4]: a zeroed need raises activity changes 156% — but the result is chores. **Reading for the owner's brief:** per-agent hunger clocks produce logistics; the only survival that produced watchable social life was *contested* (one resource, several claimants), and it produced institutions only when it ended. Keep survival as backdrop; make scarcity social (one house, one title, one heart) if used at all.

## (d) Director / drama-manager designs

- **L4D** [14]: estimate intensity per agent from recent events, decay it; build until a peak, then force relax; spawn only ahead of the group. Transfer: keep a per-relationship "tension" and a town-wide curve; after a peak scene, a mandatory quiet beat.
- **Façade** [15]: beat = preconditions + tension effect + payoff; pick the unused beat whose effect best fits the arc's next step; every beat moves affinity/tension.
- **Drama Llama** [29]: natural-language trigger conditions evaluated by an LLM after each message; first match fires; 3–4 triggers per story sufficed.
- **SHOW-1** [17]: scenes seeded from (time, location, characters, reveries); "dramatic operators" injected at act/scene/line level; highlight episode from a 24/7 sim.
- **Scoring a moment** (McKee [30], Johnstone [23]): a scene counts when a value-charge flips. Score = importance(1–10) × |Δcloseness or Δstatus| × novelty(embedding distance from last 20 moments) × witnesses; the camera follows the max, then applies an L4D cooldown. Emergence World's indicators [12] (relationship density, vocabulary diversity, constitutional growth) are the dashboard.

## (e) Open-ended invention: minting verbs, laws and ideas at runtime

- **Skill libraries.** Voyager [28]: an agent writes code for a new skill, keeps it only after self-verification, indexes it by embedding; 3.3× more unique items, 15.3× faster tech tree. Emergence World [12] lets agents register tools; LATM/CREATOR [31] split *maker* (strong model, writes + tests) from *user* (cheap model). Transfer: a verb is a named, tested procedure with preconditions and effects on world state; the cheap model calls it, the strong model authors it.
- **Adjudication.** Concordia's GM [27] resolves any natural-language action into an event statement and grounded variables; MUD/tabletop practice is the same. The 2026 rule-adherence study [32] warns: LLM referees grant unearned success up to 43% under pseudo-logical pleading, with a systematic leniency bias (false pass 9.6% vs false check 0.08%) — the referee needs a rulebook of preconditions and dice, not vibes.
- **Laws that bind.** Sid's constitution [8] worked because tax was collected by code; Institutional AI [33]: prompt-only constitutions did nothing (tier 3.02 vs 3.10), runtime enforcement with public evidence and sanctions cut severe collusion 50%→5.6%. Artificial Institutions [34]: the same agents' surplus split 83.7% vs 14.3% under different market rules. Transfer: a passed law compiles to a check the world runs, with a public ledger.
- **Culture.** Dwarf Fortress [35] generates poetic, musical and dance *forms* that spread by teaching; Sid's memes [8] were tracked as keywords in goals. Transfer: an "idea" object with a form and carriers.
- **Failure modes:** verb explosion (cap live verbs, retire unused, merge near-duplicates by embedding); hallucinated capability (a verb exists only after the GM ran it once); incoherence (Sid's bottleneck; one writer of world state); rule drift (laws stored in the world, cited by id in memories).

## (f) Recommendation for 5–15 minds

Run the town as **scenes, not ticks**: numeric needs, closeness, status and stress tick for free; an LLM is called only when a gate opens (closeness crossing a band, stress > threshold, a plan's time arrives, two agents with opposed wants share a place). Each scene is a committed option with two stated wants, a turn budget of 6–10, and a repetition exit; its output is one chronicle line plus Δnumbers, on the cheap model. Reflection (Park's Σimportance>150), law compilation, new-verb authoring and the director's beat choice go to the strong model — roughly 5–15 calls a day, not per agent. Keep a Game Master that alone writes world events and adjudicates novel verbs against preconditions; laws live in the world and are enforced by code. Score every scene by value-flip × novelty × witnesses, keep a per-town intensity curve with forced quiet after peaks, and expect the budget to land near Lyfe's $0.50/agent-hour rather than Park's $25.

## References

1. Park et al., Generative Agents (2023) — https://arxiv.org/abs/2304.03442
2. Lyfe Agents (2023) — https://arxiv.org/abs/2310.02172
3. AI Town constants — https://github.com/a16z-infra/ai-town/blob/main/convex/constants.ts ; architecture — https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md
4. Humanoid Agents (2023) — https://arxiv.org/abs/2310.05418
5. GMTK, The Genius AI Behind The Sims — https://gmtk.substack.com/p/the-genius-ai-behind-the-sims
6. Sims 2 relationships — https://strategywiki.org/wiki/The_Sims_2/Relationships
7. Sentipolis (2026) — https://arxiv.org/abs/2601.18027
8. Project Sid / PIANO (2024) — https://arxiv.org/abs/2411.00114
9. CK3 stress — https://ck3.paradoxwikis.com/Traits ; https://gamerant.com/crusader-kings-3-ck3-stress-management-tips/
10. Aaron Reed on Dwarf Fortress — https://if50.substack.com/p/2006-dwarf-fortress ; Adams, Emergent Narrative in DF — https://www.taylorfrancis.com/chapters/edit/10.1201/9780429488337-15/
11. Artificial Leviathan (2024) — https://arxiv.org/abs/2406.14373
12. Emergence World (2026) — https://arxiv.org/abs/2606.08367
13. Emergent social conventions in LLM populations (Sci. Adv. 2025) — https://arxiv.org/abs/2410.08948
14. Booth, The AI Systems of Left 4 Dead — https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf ; summary — https://www.centerconsulting.com/ai-library/concepts/l4d-director
15. Mateas & Stern, Structuring Content in Façade — https://expressiveintelligence.github.io/papers/MateasSternAIIDE05.pdf
16. RimWorld storytellers — https://rimworldwiki.com/wiki/AI_Storytellers
17. Fable, SHOW-1 / Showrunner Agents — https://fablestudio.github.io/showrunner-agents/
18. BBC Science Focus on Project Sid — https://www.sciencefocus.com/future-technology/ai-agents-village
19. Everyone Conforms, No One Believes (2026) — https://arxiv.org/abs/2608.02758
20. When language models date each other (2026) — https://www.sciencedirect.com/science/article/pii/S2949882126000575
21. Too Polite to Disagree (2026) — https://arxiv.org/abs/2604.02668
22. SOTOPIA (2023) — https://arxiv.org/abs/2310.11667
23. Johnstone, Impro (status) — https://ribbonfarm.com/2010/01/23/impro-by-keith-johnstone/
24. Affordable Generative Agents (2024) — https://arxiv.org/abs/2402.02053
25. Exploring and Controlling Diversity in LLM-Agent Conversation (2024) — https://arxiv.org/abs/2412.21102
26. Cooperate or Collapse / GovSim (2024) — https://arxiv.org/abs/2404.16698
27. Concordia (2023) — https://arxiv.org/abs/2312.03664
28. Voyager (2023) — https://arxiv.org/abs/2305.16291
29. Drama Llama (2025) — https://arxiv.org/abs/2501.09099
30. McKee, Do Your Scenes Turn? — https://mckeestory.com/do-your-scenes-turn/
31. LLM Agents Making Agent Tools (ACL 2025) — https://aclanthology.org/2025.acl-long.1266.pdf
32. Seduced by the Narrative: rule adherence in semi-open sandboxes (2026) — https://arxiv.org/abs/2607.02802
33. Institutional AI: governance graphs vs constitutions (2026) — https://arxiv.org/abs/2601.11369
34. Artificial Institutions (2026) — https://arxiv.org/abs/2608.04020
35. Dwarf Fortress procedural poetry/music/dance — https://www.metafilter.com/148240/Dorf-poetry-music-and-dance
Also consulted: Generative Agent Simulations of 1,000 People — https://arxiv.org/abs/2411.10109 ; AgentSociety — https://arxiv.org/abs/2502.08691 ; CAMEL — https://arxiv.org/abs/2303.17760 ; TV writers' rooms — https://scriptmag.com/features/writers-room-101-beats-breaking-blending
