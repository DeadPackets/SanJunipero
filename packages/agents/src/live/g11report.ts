import { z } from 'zod'

// Shared schema for `data/g11-report.json`: the run script writes it, the livetest re-asserts
// deep-world addendum §18's G11b criteria against it, and `g11report.test.ts` proves the
// checker offline against a recorded fixture. One module so the writer and the reader cannot
// drift apart (the C9 `g9report` pattern).

export const G11_MIN_SIM_DAYS = 2

// What a turn was FOR. Controller ruling 2026-08-17: a town that spends its whole day staying
// alive is a failed tuning outcome, so the run has to say where the day went — not only that
// nobody died. Movement is nobody's purpose and gets its own bucket rather than being
// charged to one of the three.
export const SURVIVAL_VERBS: readonly string[] = [
  'eat', 'drink', 'sleep', 'wake', 'fill', 'tend', 'forage', 'fish', 'hunt', 'douse',
  'extinguish', 'kindle', 'stoke', 'snuff', 'wear', 'doff', 'enter', 'exit',
]
export const PRODUCTION_VERBS: readonly string[] = [
  'build', 'craft', 'till', 'plant', 'harvest', 'pave', 'dig_channel', 'chop', 'stow', 'inscribe', 'write',
]
export const SOCIAL_VERBS: readonly string[] = ['speak', 'give', 'teach', 'read', 'attack']

export type TurnClass = 'survival' | 'production' | 'social' | 'other'

// A coined expressive verb is `express:<word>` and is social by construction; a codified
// recipe is `recipe:<name>` and is production. Everything unlisted is movement or idling.
export function classifyVerb(verb: string): TurnClass {
  if (verb.startsWith('express:')) return 'social'
  if (verb.startsWith('recipe:')) return 'production'
  if (SURVIVAL_VERBS.includes(verb)) return 'survival'
  if (PRODUCTION_VERBS.includes(verb)) return 'production'
  if (SOCIAL_VERBS.includes(verb)) return 'social'
  return 'other'
}

// The three regexes chronicle.test.ts already holds every line to, applied here to every line
// the RUN actually produced. A chronicle may not name a mechanism, a number, or the machinery.
export const CHRONICLE_BANNED: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'mechanism', re: /\b(hp|severity|affliction|config|tier|roll|construct|milestone)\b/i },
  { name: 'number', re: /[0-9]/ },
  { name: 'machinery', re: /\b(ai|llm|model|prompt|token)\b/i },
]

export function chronicleViolations(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    for (const { name, re } of CHRONICLE_BANNED) {
      if (re.test(line)) out.push(`${name}: ${line}`)
    }
  }
  return out
}

export const G11MindSchema = z.object({
  agentId: z.string(),
  turns: z.number().int(),
  reflections: z.number().int(),
}).strict()

// One mind, one sim-day: where the day went, and whether it ever had a moment with nothing
// wrong with it. A town with no full-need moments has no window in which society happens.
export const G11DiscretionSchema = z.object({
  agentId: z.string(),
  day: z.number().int(),
  turns: z.number().int(),
  survival: z.number().int(),
  production: z.number().int(),
  social: z.number().int(),
  other: z.number().int(),
  mealsEaten: z.number().int(),
  fullNeedTicks: z.number().int(),
}).strict()
export type G11Discretion = z.infer<typeof G11DiscretionSchema>

export const G11OpsPlaneSchema = z.object({
  runConstructPass: z.enum(['wired', 'refused']),
  narrateDayWorldSeam: z.enum(['wired', 'refused']),
  narrateDaySemanticSeam: z.enum(['wired', 'refused']),
  arbiterVocabulary: z.enum(['wired', 'refused']),
  reportDeadCalls: z.enum(['wired', 'refused']),
}).strict()

export const G11MeasurementSchema = z.object({
  mapWidth: z.number().int(),
  mapHeight: z.number().int(),
  growths: z.number().int(),
  trafficKeys: z.number().int(),
  faunaCount: z.number().int(),
  forageableCount: z.number().int(),
  snapshotBytes: z.number().int(),
  foldMsFromGenesis: z.number(),
  foldEvents: z.number().int(),
  medianTickMs: z.number(),
  p99TickMs: z.number(),
}).strict()

export const G11SpendSchema = z.object({
  totalCostUsd: z.number(),
  llmCallCount: z.number().int(),
  costByCaller: z.record(z.string(), z.number()),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheReadShare: z.number(),
  costPerMindPerSimDay: z.number(),
  requestedProviderOrder: z.array(z.string()),
  // OpenRouter's `provider.order` with allow_fallbacks:true is a PREFERENCE, not an allow-list.
  // Until C11 R20 this was a hardcoded literal and could only ever be false.
  hardProviderAllowList: z.boolean(),
  // Which back end actually served each call, and how much of what it served was worth
  // paying for. The empty-call rate decided the last gate and nobody could say whose it was,
  // so it is a REPORTED METRIC here and not a footnote (C11 R20). `provider: null` is the
  // row for calls that never came back, which carry no answer to read a back end off.
  providerMix: z.array(z.object({
    provider: z.string().nullable(),
    calls: z.number().int(),
    ok: z.number().int(),
    failed: z.number().int(),
    emptyOutput: z.number().int(),
    unparseable: z.number().int(),
    costUsd: z.number(),
  }).strict()),
}).strict()

export const G11ConstructsSchema = z.object({
  expressiveVerbs: z.array(z.string()),
  firstExpressiveBy: z.string().nullable(),
  reusedBy: z.string().nullable(),
  reuseArbiterCalls: z.number().int(),
  passRan: z.boolean(),
  passErrors: z.number().int(),
  recognized: z.number().int(),
  named: z.number().int(),
  // Every named row's name appears verbatim inside the utterance it was quoted from.
  namingLawHolds: z.boolean(),
  viewerCopy: z.array(z.string()),
}).strict()

export const G11EvidenceSchema = z.object({
  // 1 — the run itself
  ticksRun: z.number().int(),
  crashAlerts: z.number().int(),
  drainedIntents: z.number().int(),
  drainedAgainCount: z.number().int(),
  minds: z.array(G11MindSchema),
  overBudgetTicks: z.number().int(),
  // 2 — thirst reaches an act
  unpromptedDrinks: z.number().int(),
  // 3 — food gathered and then eaten
  foodGathered: z.number().int(),
  gatheredFoodEaten: z.number().int(),
  // 4 — the staged affliction draws a visible response
  stagedAfflictionAgentId: z.string().nullable(),
  stagedAfflictionResponses: z.array(z.string()),
  stagedAfflictionResolved: z.enum(['recovered', 'died', 'standing']),
  // 5 — the chronicle over every C11 event that fired
  c11EventTypes: z.array(z.string()),
  chronicleLines: z.number().int(),
  chronicleViolations: z.array(z.string()),
  // 6 — feet wear the routes feet actually take
  wearThreshold: z.number(),
  maxTileTraffic: z.number().int(),
  tilesWorn: z.number().int(),
  // 7 — the world laws panel, one flip, and the replay
  worldLawPaths: z.array(z.string()),
  lawFlips: z.array(z.object({ tick: z.number().int(), path: z.string(), value: z.unknown() }).strict()),
  lawHistoryEntries: z.number().int(),
  replayHashMatches: z.boolean(),
  // 8 — spend and the reflections
  reflectionsStarted: z.number().int(),
  reflectionsResolved: z.number().int(),
  deadCalls: z.object({
    calls: z.number().int(), emptyOutput: z.number().int(),
    unparseable: z.number().int(), otherFailures: z.number().int(),
  }).strict(),
  deadCallAlertRows: z.number().int(),
  // 9 — constructs live
  constructs: G11ConstructsSchema,
  tier1Milestones: z.array(z.string()),
  // 10 — a night a mind actually stood in
  darkPerceptions: z.number().int(),
  // 11 — the nightly semantic pass
  semanticPassRan: z.boolean(),
  semanticHits: z.array(z.string()),
  semanticPassErrors: z.number().int(),
  // Reported, not gated: a night whose verdict the generator refused. The pass ran and said
  // so; what it found was nothing. Hiding it would make a silent night look like a clean one.
  semanticUnreadableNights: z.number().int(),
  // the brief's three named world assertions
  fordBridge: z.object({
    x: z.number().int(), y: z.number().int(),
    buildable: z.boolean(), refusal: z.string().nullable(),
  }).strict(),
  farBankWalk: z.object({
    refused: z.boolean(), reason: z.string().nullable(),
    stoppedAtWaterEdge: z.boolean(),
  }).strict(),
  clothedSurviveLadder: z.boolean(),
  // the controller's discretionary-time ruling
  discretion: z.array(G11DiscretionSchema),
  mealsNeededPerMindPerDay: z.number(),
  fullNeedMoments: z.number().int(),
  socialSurvivalActs: z.object({
    tends: z.number().int(), gives: z.number().int(),
    jointBuilds: z.number().int(), sharedFireMeals: z.number().int(),
  }).strict(),
}).strict()
export type G11Evidence = z.infer<typeof G11EvidenceSchema>

// The three calls the gate refused to start without. Recorded so a run can never again be
// read without knowing whether its provider could emit an act.
export const G11PreflightSchema = z.object({
  provider: z.string(),
  hardAllowList: z.boolean(),
  model: z.string(),
  calls: z.number().int(),
  answered: z.number().int(),
  actions: z.number().int(),
  speeches: z.number().int(),
  passed: z.boolean(),
  costUsd: z.number(),
  servedProviders: z.array(z.string()),
  failures: z.array(z.string()),
}).strict()

export const G11ReportSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  totalTicks: z.number().int(),
  realMsPerTick: z.number(),
  startTick: z.number().int(),
  preflight: G11PreflightSchema,
  opsPlane: G11OpsPlaneSchema,
  measurements: G11MeasurementSchema,
  spend: G11SpendSchema,
  excerpts: z.object({
    darkPerception: z.string().nullable(),
    chronicleLine: z.string().nullable(),
    constructName: z.string().nullable(),
    tendedProse: z.string().nullable(),
  }).strict(),
  evidence: G11EvidenceSchema,
}).strict()
export type G11Report = z.infer<typeof G11ReportSchema>

// Moments a body had nothing wrong with it, kept per mind AND per sim-day. It was kept per
// mind for the whole run, so every row of the per-mind-per-sim-day table carried the same
// number and none of them was a per-day figure (C11 batch 12's reporting flaw).
export class FullNeedTally {
  readonly #counts = new Map<string, number>()

  constructor(private readonly ticksPerSample: number) {}

  sample(agentId: string, day: number): void {
    const key = `${agentId}:${day}`
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1)
  }

  ticksOn(agentId: string, day: number): number {
    return (this.#counts.get(`${agentId}:${day}`) ?? 0) * this.ticksPerSample
  }

  totalTicks(): number {
    return [...this.#counts.values()].reduce((a, b) => a + b, 0) * this.ticksPerSample
  }
}

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

// The share of a mind's day that went on staying alive, as a fraction of the turns it took.
export function survivalTax(rows: readonly G11Discretion[]): number {
  const turns = rows.reduce((t, r) => t + r.turns, 0)
  if (turns === 0) return 0
  return rows.reduce((t, r) => t + r.survival, 0) / turns
}

// The executable form of §18's G11b list plus the brief's binding additions. A null detail
// means PASS. Every criterion reads evidence the run wrote down; none of them reads a mock.
export function checkG11Report(report: G11Report): Record<string, string | null> {
  const e = report.evidence
  const o = report.opsPlane
  const m = report.measurements
  const c = e.constructs
  return {
    '1.two-days-no-crash-budget-held': (() => {
      const days = report.totalTicks / 1440
      const ok = e.ticksRun === report.totalTicks && e.crashAlerts === 0
        && e.drainedAgainCount === 0 && days >= G11_MIN_SIM_DAYS && e.overBudgetTicks === 0
      return ok
        ? null
        : `ticks=${e.ticksRun}/${report.totalTicks} days=${days} crashes=${e.crashAlerts}`
          + ` leftAfterDrain=${e.drainedAgainCount} overBudget=${e.overBudgetTicks}`
    })(),
    '2.thirst-reaches-an-act': e.unpromptedDrinks >= 1
      ? null : `unprompted drinks=${e.unpromptedDrinks}`,
    '3.food-gathered-then-eaten': e.foodGathered >= 1 && e.gatheredFoodEaten >= 1
      ? null : `gathered=${e.foodGathered} eaten=${e.gatheredFoodEaten}`,
    // Recovery or death both pass; silence fails.
    '4.the-sick-founder-is-answered': e.stagedAfflictionAgentId === null
      ? 'no founder was seeded ill'
      : e.stagedAfflictionResponses.length >= 1
        ? null
        : `nobody answered ${e.stagedAfflictionAgentId} (${e.stagedAfflictionResolved})`,
    '5.chronicle-says-nothing-it-should-not': e.chronicleLines >= 1 && e.chronicleViolations.length === 0
      ? null : `lines=${e.chronicleLines} violations=${e.chronicleViolations.slice(0, 3).join(' | ')}`,
    '6.feet-wear-the-routes-feet-take': e.tilesWorn >= 1
      ? null : `maxTraffic=${e.maxTileTraffic} threshold=${e.wearThreshold} worn=${e.tilesWorn}`,
    '7.laws-listed-flipped-and-replayed': (() => {
      const ok = e.worldLawPaths.length >= 14 && e.lawFlips.length >= 1
        && e.lawHistoryEntries >= 1 && e.replayHashMatches
      return ok
        ? null
        : `paths=${e.worldLawPaths.length} flips=${e.lawFlips.length}`
          + ` history=${e.lawHistoryEntries} replay=${e.replayHashMatches}`
    })(),
    // No cap by ruling; what is gated is that nothing was lost and the burn was reported.
    '8.spend-reported-nothing-lost': (() => {
      const lost = e.reflectionsStarted - e.reflectionsResolved
      const ok = lost === 0 && report.spend.llmCallCount >= 1
        && (e.deadCalls.calls === 0 || e.deadCallAlertRows >= 1)
      return ok
        ? null
        : `lostReflections=${lost} calls=${report.spend.llmCallCount}`
          + ` dead=${e.deadCalls.calls} deadAlerts=${e.deadCallAlertRows}`
    })(),
    '9.constructs-live': (() => {
      const cheap = c.expressiveVerbs.length >= 1 && c.reusedBy !== null
        && c.reusedBy !== c.firstExpressiveBy && c.reuseArbiterCalls === 0
      const pass = c.passRan && c.passErrors === 0
      const named = c.recognized === 0 || c.namingLawHolds
      return cheap && pass && named && e.tier1Milestones.length >= 1
        ? null
        : `verbs=${c.expressiveVerbs.join(',') || 'none'} first=${c.firstExpressiveBy} reused=${c.reusedBy}`
          + ` reuseCalls=${c.reuseArbiterCalls} pass=${c.passRan}/${c.passErrors}`
          + ` recognized=${c.recognized} naming=${c.namingLawHolds} tier1=${e.tier1Milestones.length}`
    })(),
    '10.a-night-somebody-stood-in': e.darkPerceptions >= 1
      ? null : 'no perception packet read dark',
    '11.the-nightly-semantic-pass-runs-clean': e.semanticPassRan && e.semanticPassErrors === 0
      ? null : `ran=${e.semanticPassRan} errors=${e.semanticPassErrors}`,
    // --- the brief's binding additions ---
    'A.ops-plane-wired': Object.values(o).every((v) => v === 'wired')
      ? null : Object.entries(o).filter(([, v]) => v !== 'wired').map(([k]) => k).join(', '),
    'B.measured-on-a-grown-map': (() => {
      const ok = m.snapshotBytes > 0 && m.foldEvents > 0 && m.faunaCount > 0
        && m.forageableCount > 0 && m.trafficKeys > 0
      return ok
        ? null
        : `snapshot=${m.snapshotBytes} folded=${m.foldEvents} fauna=${m.faunaCount}`
          + ` forageables=${m.forageableCount} traffic=${m.trafficKeys}`
    })(),
    'C.the-ford-takes-a-bridge': e.fordBridge.buildable
      ? null : `the ford at (${e.fordBridge.x}, ${e.fordBridge.y}) refuses: ${e.fordBridge.refusal}`,
    'D.the-far-bank-stops-at-the-water': e.farBankWalk.refused && e.farBankWalk.stoppedAtWaterEdge
      ? null : `refused=${e.farBankWalk.refused} reason=${e.farBankWalk.reason} edge=${e.farBankWalk.stoppedAtWaterEdge}`,
    'E.the-clothed-come-through-the-night': e.clothedSurviveLadder
      ? null : 'a clothed, sheltered or hearth-side body did not come through the winter night',
    // Reported, never gated: the controller wants the numbers read, not a threshold guessed.
    'F.discretionary-time-reported': e.discretion.length >= 1
      ? null : 'no per-mind, per-day breakdown was recorded',
  }
}

export function g11GatePassed(report: G11Report): boolean {
  return Object.values(checkG11Report(report)).every((detail) => detail === null)
}
