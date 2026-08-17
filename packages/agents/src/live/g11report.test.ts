import { describe, expect, it } from 'vitest'
import {
  CHRONICLE_BANNED, G11ReportSchema, G11_MIN_SIM_DAYS, checkG11Report, chronicleViolations,
  classifyVerb, g11GatePassed, median, survivalTax, type G11Report,
} from './g11report.js'

// Offline, $0: the checker is proved against a recorded fixture before a single live call is
// made. A criterion that cannot fail on a doctored report is not a criterion (the C9
// `g9report` pattern).

// A pass-shaped report. Every row below is a plausible reading off a real 2-sim-day run.
const PASSING: G11Report = {
  generatedAt: '2026-08-17T12:00:00.000Z',
  model: 'deepseek/deepseek-v4-flash-0731',
  totalTicks: 2880,
  realMsPerTick: 250,
  startTick: 420,
  opsPlane: {
    runConstructPass: 'wired',
    narrateDayWorldSeam: 'wired',
    narrateDaySemanticSeam: 'wired',
    arbiterVocabulary: 'wired',
    reportDeadCalls: 'wired',
  },
  measurements: {
    mapWidth: 128, mapHeight: 128, growths: 0,
    trafficKeys: 412, faunaCount: 26, forageableCount: 20,
    snapshotBytes: 214_880, foldMsFromGenesis: 91.4, foldEvents: 51_233,
    medianTickMs: 0.6, p99TickMs: 4.1,
  },
  spend: {
    totalCostUsd: 2.31, llmCallCount: 604,
    costByCaller: { turn: 1.9, reflection: 0.2, arbiter: 0.15, narrator: 0.06 },
    inputTokens: 1_800_000, outputTokens: 82_000, cacheReadTokens: 122_400,
    cacheReadShare: 0.068, costPerMindPerSimDay: 0.231,
    requestedProviderOrder: ['Baidu'], hardProviderAllowList: false,
  },
  excerpts: {
    darkPerception: 'It is dark here.',
    chronicleLine: 'Nadia laid a stretch of road.',
    constructName: null,
    tendedProse: 'Omar cared for Salma.',
  },
  evidence: {
    ticksRun: 2880, crashAlerts: 0, drainedIntents: 3, drainedAgainCount: 0,
    minds: [
      { agentId: 'amara', turns: 41, reflections: 2 },
      { agentId: 'yusuf', turns: 39, reflections: 2 },
    ],
    overBudgetTicks: 0,
    unpromptedDrinks: 4,
    foodGathered: 6, gatheredFoodEaten: 3,
    stagedAfflictionAgentId: 'salma',
    stagedAfflictionResponses: ['tend by omar at tick 980'],
    stagedAfflictionResolved: 'recovered',
    c11EventTypes: ['agent_afflicted', 'agent_tended', 'tile_changed', 'fauna_killed'],
    chronicleLines: 37, chronicleViolations: [],
    wearThreshold: 12, maxTileTraffic: 31, tilesWorn: 2,
    worldLawPaths: [
      'mortality.enabled', 'illness.enabled', 'thirst.enabled', 'fertility.enabled',
      'roads.enabled', 'desirePaths.enabled', 'fauna.enabled', 'warmth.enabled',
      'light.enabled', 'nightWitness.enabled', 'foodVariety.enabled', 'regrowth.enabled',
      'mapGrowth.enabled', 'constructs.enabled',
    ],
    lawFlips: [{ tick: 1800, path: 'desirePaths.wearThreshold', value: 12 }],
    lawHistoryEntries: 1, replayHashMatches: true,
    reflectionsStarted: 4, reflectionsResolved: 4,
    deadCalls: { calls: 12, emptyOutput: 8, unparseable: 3, otherFailures: 1 },
    deadCallAlertRows: 2,
    constructs: {
      expressiveVerbs: ['express:sing'], firstExpressiveBy: 'amara', reusedBy: 'yusuf',
      reuseArbiterCalls: 0, passRan: true, passErrors: 0,
      recognized: 0, named: 0, namingLawHolds: true, viewerCopy: [],
    },
    tier1Milestones: ['first_speech', 'first_meal'],
    darkPerceptions: 61,
    semanticPassRan: true, semanticHits: [], semanticPassErrors: 0, semanticUnreadableNights: 1,
    fordBridge: { x: 50, y: 50, buildable: true, refusal: null },
    farBankWalk: { refused: true, reason: 'no path to that spot', stoppedAtWaterEdge: true },
    clothedSurviveLadder: true,
    discretion: [
      { agentId: 'amara', day: 0, turns: 20, survival: 8, production: 6, social: 4, other: 2, mealsEaten: 2, fullNeedTicks: 610 },
      { agentId: 'yusuf', day: 0, turns: 20, survival: 12, production: 4, social: 3, other: 1, mealsEaten: 1, fullNeedTicks: 240 },
    ],
    mealsNeededPerMindPerDay: 0.84,
    fullNeedMoments: 850,
    socialSurvivalActs: { tends: 1, gives: 2, jointBuilds: 1, sharedFireMeals: 0 },
  },
}

const broken = (edit: (r: G11Report) => void): G11Report => {
  const copy = structuredClone(PASSING)
  edit(copy)
  return copy
}

const failing = (r: G11Report): string[] =>
  Object.entries(checkG11Report(r)).filter(([, d]) => d !== null).map(([k]) => k)

describe('the report shape', () => {
  it('parses the recorded fixture and refuses an unknown field', () => {
    expect(() => G11ReportSchema.parse(PASSING)).not.toThrow()
    expect(G11ReportSchema.safeParse({ ...PASSING, extra: 1 }).success).toBe(false)
  })
})

describe('the pure helpers', () => {
  it('sorts a turn into the thing it was for', () => {
    expect(classifyVerb('eat')).toBe('survival')
    expect(classifyVerb('drink')).toBe('survival')
    expect(classifyVerb('build')).toBe('production')
    expect(classifyVerb('recipe:boil_salt')).toBe('production')
    expect(classifyVerb('speak')).toBe('social')
    expect(classifyVerb('express:sing')).toBe('social')
    expect(classifyVerb('walk')).toBe('other')
  })

  it('reads the survival tax off the per-mind rows', () => {
    expect(survivalTax(PASSING.evidence.discretion)).toBeCloseTo(20 / 40, 12)
    expect(survivalTax([])).toBe(0)
  })

  it('takes the middle of an even and an odd list', () => {
    expect(median([])).toBe(0)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
  })

  it('catches a chronicle line that names a mechanism, a number or the machinery', () => {
    expect(chronicleViolations(['Nadia laid a stretch of road.'])).toEqual([])
    expect(chronicleViolations(['Salma lost 12 hp.'])).toHaveLength(2) // a number AND a mechanism
    expect(chronicleViolations(['The model chose for her.'])).toHaveLength(1)
    expect(CHRONICLE_BANNED.map((b) => b.name)).toEqual(['mechanism', 'number', 'machinery'])
  })
})

describe('the gate criteria', () => {
  it('passes the recorded fixture, every criterion', () => {
    expect(checkG11Report(PASSING)).toEqual({
      '1.two-days-no-crash-budget-held': null,
      '2.thirst-reaches-an-act': null,
      '3.food-gathered-then-eaten': null,
      '4.the-sick-founder-is-answered': null,
      '5.chronicle-says-nothing-it-should-not': null,
      '6.feet-wear-the-routes-feet-take': null,
      '7.laws-listed-flipped-and-replayed': null,
      '8.spend-reported-nothing-lost': null,
      '9.constructs-live': null,
      '10.a-night-somebody-stood-in': null,
      '11.the-nightly-semantic-pass-runs-clean': null,
      'A.ops-plane-wired': null,
      'B.measured-on-a-grown-map': null,
      'C.the-ford-takes-a-bridge': null,
      'D.the-far-bank-stops-at-the-water': null,
      'E.the-clothed-come-through-the-night': null,
      'F.discretionary-time-reported': null,
    })
    expect(g11GatePassed(PASSING)).toBe(true)
  })

  it('a short run fails criterion 1, and so does a tick over the budget', () => {
    expect(failing(broken((r) => { r.totalTicks = 1440; r.evidence.ticksRun = 1440 })))
      .toContain('1.two-days-no-crash-budget-held')
    expect(G11_MIN_SIM_DAYS).toBe(2)
    expect(failing(broken((r) => { r.evidence.overBudgetTicks = 3 })))
      .toContain('1.two-days-no-crash-budget-held')
    expect(failing(broken((r) => { r.evidence.crashAlerts = 1 })))
      .toContain('1.two-days-no-crash-budget-held')
  })

  it('a town that never drank, never ate what it gathered, or never saw the dark, fails', () => {
    expect(failing(broken((r) => { r.evidence.unpromptedDrinks = 0 }))).toContain('2.thirst-reaches-an-act')
    expect(failing(broken((r) => { r.evidence.gatheredFoodEaten = 0 }))).toContain('3.food-gathered-then-eaten')
    expect(failing(broken((r) => { r.evidence.darkPerceptions = 0 }))).toContain('10.a-night-somebody-stood-in')
  })

  it('silence around the sick founder fails, and both a recovery and a death pass', () => {
    expect(failing(broken((r) => { r.evidence.stagedAfflictionResponses = [] })))
      .toContain('4.the-sick-founder-is-answered')
    expect(failing(broken((r) => { r.evidence.stagedAfflictionResolved = 'died' })))
      .not.toContain('4.the-sick-founder-is-answered')
    expect(failing(broken((r) => { r.evidence.stagedAfflictionAgentId = null })))
      .toContain('4.the-sick-founder-is-answered')
  })

  it('one banned word anywhere in the chronicle fails the whole scan', () => {
    expect(failing(broken((r) => { r.evidence.chronicleViolations = ['number: she lost 12'] })))
      .toContain('5.chronicle-says-nothing-it-should-not')
    expect(failing(broken((r) => { r.evidence.chronicleLines = 0 })))
      .toContain('5.chronicle-says-nothing-it-should-not')
  })

  it('a run where no tile wore through fails, whatever the traffic says', () => {
    expect(failing(broken((r) => { r.evidence.tilesWorn = 0 })))
      .toContain('6.feet-wear-the-routes-feet-take')
  })

  it('the laws panel has to list all fourteen C11 flags, flip one, and still replay', () => {
    expect(failing(broken((r) => { r.evidence.worldLawPaths = r.evidence.worldLawPaths.slice(0, 13) })))
      .toContain('7.laws-listed-flipped-and-replayed')
    expect(failing(broken((r) => { r.evidence.lawFlips = [] })))
      .toContain('7.laws-listed-flipped-and-replayed')
    expect(failing(broken((r) => { r.evidence.replayHashMatches = false })))
      .toContain('7.laws-listed-flipped-and-replayed')
  })

  it('a lost reflection fails, and dead calls nobody was told about fail', () => {
    expect(failing(broken((r) => { r.evidence.reflectionsResolved = 3 })))
      .toContain('8.spend-reported-nothing-lost')
    expect(failing(broken((r) => { r.evidence.deadCallAlertRows = 0 })))
      .toContain('8.spend-reported-nothing-lost')
    // A run with nothing dead in it needs no alert at all.
    expect(failing(broken((r) => {
      r.evidence.deadCalls = { calls: 0, emptyOutput: 0, unparseable: 0, otherFailures: 0 }
      r.evidence.deadCallAlertRows = 0
    }))).not.toContain('8.spend-reported-nothing-lost')
  })

  it('the second body has to be a DIFFERENT body, and it has to cost nothing', () => {
    expect(failing(broken((r) => { r.evidence.constructs.reusedBy = 'amara' })))
      .toContain('9.constructs-live')
    expect(failing(broken((r) => { r.evidence.constructs.reuseArbiterCalls = 1 })))
      .toContain('9.constructs-live')
    expect(failing(broken((r) => { r.evidence.constructs.passRan = false })))
      .toContain('9.constructs-live')
    expect(failing(broken((r) => { r.evidence.tier1Milestones = [] })))
      .toContain('9.constructs-live')
    // A recognized construct whose name is not in the record it was quoted from fails.
    expect(failing(broken((r) => {
      r.evidence.constructs.recognized = 1
      r.evidence.constructs.namingLawHolds = false
    }))).toContain('9.constructs-live')
    // Nothing recognized in two days is not a failure — the first festival is not schedulable.
    expect(failing(broken((r) => { r.evidence.constructs.recognized = 0 })))
      .not.toContain('9.constructs-live')
  })

  it('an ops-plane seam left unwired names itself', () => {
    const out = checkG11Report(broken((r) => {
      r.opsPlane.reportDeadCalls = 'refused'
      r.opsPlane.arbiterVocabulary = 'refused'
    }))
    expect(out['A.ops-plane-wired']).toBe('arbiterVocabulary, reportDeadCalls')
  })

  it('the measurement rows must be readings and not zeroes', () => {
    expect(failing(broken((r) => { r.measurements.trafficKeys = 0 }))).toContain('B.measured-on-a-grown-map')
    expect(failing(broken((r) => { r.measurements.snapshotBytes = 0 }))).toContain('B.measured-on-a-grown-map')
  })

  it('the three named world assertions each fail on their own', () => {
    expect(failing(broken((r) => { r.evidence.fordBridge.buildable = false })))
      .toContain('C.the-ford-takes-a-bridge')
    expect(failing(broken((r) => { r.evidence.farBankWalk.stoppedAtWaterEdge = false })))
      .toContain('D.the-far-bank-stops-at-the-water')
    expect(failing(broken((r) => { r.evidence.clothedSurviveLadder = false })))
      .toContain('E.the-clothed-come-through-the-night')
  })

  it('the discretionary-time table is required to exist, and is never itself a threshold', () => {
    expect(failing(broken((r) => { r.evidence.discretion = [] })))
      .toContain('F.discretionary-time-reported')
    // A town spending its whole day on survival still PASSES: the ruling asks for the number
    // to be read, not for a line to be drawn where nobody has ruled one.
    const grim = broken((r) => {
      for (const row of r.evidence.discretion) {
        row.survival = row.turns; row.production = 0; row.social = 0; row.other = 0
      }
    })
    expect(survivalTax(grim.evidence.discretion)).toBe(1)
    expect(failing(grim)).not.toContain('F.discretionary-time-reported')
  })
})
