# Folk backend field map

Read-only inspection of the scripted local town at `http://127.0.0.1:8768/`. World snapshot tick 2491. HTTP reads shortly afterward. AI minds remain off.

Interactive captured records: http://127.0.0.1:8772/game/data/

| Information | Fields | Source | Availability | Placement |
|---|---|---|---|---|
| Identity & portrait | Name, age, portrait / sprite, arrival, departure | World snapshot + asset records | Ready now | Card header. Keep portrait → sprite → initial fallbacks. |
| Right now | Activity, remaining duration, location, sleep, nearby people | World snapshot + existing status/place helpers | Ready now | Now view. Describe the current verb. Do not turn a null activity into “resting”. |
| Body & wellbeing | Food, rest, warmth, company, health, water, injuries, illness | World snapshot | Ready now | Food/rest at a glance. Other needs and conditions expand on request. Higher needs values mean more of that need is met. |
| Craft & belongings | Skill XP, carried items, equipped clothing | World snapshot | Ready now | Skill crests + inventory. Use existing XP bands. There is no backend character level. |
| Family & home | Partners, parents, children and household membership | /api/lineage + world snapshot | Ready now | Relationships. Keep kinship distinct from closeness. |
| Social relationships | Bond kind, strength, warmth, dated acts and change over time | /api/bonds | Available, empty here | Relationship cards with recorded evidence. No bond records does not mean no family. |
| Goals, mood & thoughts | Goal, worry, mood and latest thought | /api/aims + mood/thought socket frames | Needs recorded mind output | Optional section in Now. Show the speaker and time. Missing data is not a neutral mood or a new generated thought. |
| Personal record | Journal entries, dreams, personality changes, personal ledgers | /api/agent/:id/journal · personality · ledgers | Needs recorded mind output | History with expandable Journal / Changes. Label dreams and personal opinions as such. |
| Public history | Recorded events, biographies, scene summaries, milestones | /api/chronicle · /api/moments · /api/dispatches | Events ready; prose empty here | Filter by person. Do not invent a “Today so far” summary or claim unseen events were observed. |
| Following & notebook | People followed, profiles opened, moments read | Viewer state, not the simulation | Prototype only | Save per viewer during integration. These counters measure viewing, not a person’s XP. |

## Measured local responses

12 agents, 14 non-lamp structures, 3 parent links, 2 partnerships, 4 households and 22 Chronicle entries. Aims, bonds, laws, milestones and all dispatch collections were empty. Amara’s journal, personality and ledger endpoints returned empty arrays. All 10 inspected endpoints returned HTTP 200.

## Integration constraints

- `AgentBody.skills` stores XP, not character levels. Reuse `skillBand`/`skillPhrase` from `packages/web/src/ui/roster/expand.ts`. “Level 4” in the mock is illustrative only. A numeric level system requires an explicit mapping decision.
- `needs.hunger` maps to Food and `needs.energy` maps to Rest. Higher values mean more of the need is met. Thirst uses the existing default/accessor, not a missing-as-zero conversion.
- Use `placeOf`, activity/status helpers and the asset fallback chain. A null activity is not evidence that someone is resting. Nearby people are not automatically friends.
- Body state follows replay via the store. Latest-only aims, lineage, bonds and document feeds need replay-aware reads or an explicit current-record label. Filter dated events/documents to the viewed tick where possible; never leak later facts into historical UI.
- Fetch journals, personality and ledgers only for the open person/section. Reuse existing shared feeds. Show loading, empty and failure as distinct states.
- Goals, worries and thoughts are recorded mind output. Journals, dreams and personal opinions need their labels. Public biographies are narrator output. Do not create prose to fill an empty field.
- The viewer can follow and explore without issuing commands to people. Follow/notebook persistence is viewer work, not a simulation field.

## Source references

- `packages/engine/src/state.ts`: AgentBody, Structure, Item.
- `packages/shared/src/protocol.ts`: snapshot, tick, mood, thought and scene frames.
- `packages/gateway/src/api.ts`: agent documents, aims, provenance and laws.
- `packages/web/src/paper/pages/Person.tsx`: existing body, inventory, journal, biography, relationship and ledger reads.
- `packages/web/src/ui/feeds.ts`: shared endpoint feeds.
- `packages/shared/src/lawsApi.ts`: agreement text, proposer, dates, votes, why, enforcement and breaches.

Prototype changes are not a production integration. No test suites or release gates were run.
