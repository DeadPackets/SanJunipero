import type { LibraryCategory } from '@sj/shared'
import { EST_COST_PER_IMAGE } from '../imageClient.js'
import { EST_COST_PER_VISION_CALL } from '../visionQa/visionJudge.js'
import { STYLE_PROMPT, STYLE_ANCHOR_CLAUSE } from '../styleBible.js'
import { LIBRARY, type LibraryEntry } from './catalog.js'

// One batch per eyeball: the runner refuses to make all 50 in a single unwatched go.
export const LIBRARY_BATCHES = ['tools', 'foods', 'materials', 'ritual', 'furniture'] as const
export type LibraryBatch = (typeof LIBRARY_BATCHES)[number]

const BATCH_CATEGORY: Record<LibraryBatch, LibraryCategory> = {
  tools: 'tool', foods: 'food', materials: 'material', ritual: 'ritual', furniture: 'furniture',
}

// One candidate per attempt, and the gate's retry loop does the choosing. Picking between
// parallel candidates needs a pixel heuristic, and no pixel heuristic tells a pail from a
// market stall — the judge does, and three judged attempts cost less than two blind ones.
export const DEFAULT_CANDIDATES: Record<LibraryBatch, number> = {
  tools: 1, foods: 1, materials: 1, ritual: 1, furniture: 1,
}

const CATEGORY_HINT: Record<LibraryCategory, string> = {
  tool: 'A single small hand tool sprite, lying at a slight angle so its whole shape reads.',
  food: 'A single small food sprite, seen from a low three-quarter angle.',
  material: 'A single small pile or bundle of raw material, seen from a low three-quarter angle.',
  ritual: 'A single small ceremonial object sprite, seen from a low three-quarter angle.',
  furniture: 'A single piece of furniture in the same 2:1 dimetric projection as the reference, seen from the fixed camera.',
}

export type PlannedItem = {
  entry: LibraryEntry
  boilerplate: string
  commissionText: string
  prompt: string
  candidates: number
}

// At 24 px the instruction was "few colours, no hair-thin detail" — survival advice for a
// cell that could not hold detail. At the C-level 128 px cell the cell CAN hold it, and an
// under-detailed sprite is the failure mode instead.
export function itemBoilerplate(e: LibraryEntry): string {
  const density = e.spritePx >= 64
    ? `The artwork is drawn at ${e.spritePx} pixels across, so it carries real detail: ` +
      'visible grain and joinery, three or four tones per material with a clear light side ' +
      'and shade side, a crisp one-pixel outline, and no soft or blurred edges anywhere.'
    : `The artwork must stay readable when shown at ${e.spritePx} pixels across: ` +
      'bold silhouette, few colours, no hair-thin detail.'
  return `${STYLE_PROMPT} ${CATEGORY_HINT[e.category]} Style: ${STYLE_ANCHOR_CLAUSE}. ${density}`
}

export function itemCommission(e: LibraryEntry): string {
  return `Subject: ${e.desc}. One object only, centred, filling the frame, nothing else in view.` +
    ' No stone base, no plinth, no ground tile, no scenery, no second object.'
}

export function planBatch(batch: string, opts: { candidates?: number } = {}): PlannedItem[] {
  if (!(LIBRARY_BATCHES as readonly string[]).includes(batch))
    throw new Error(`unknown batch ${JSON.stringify(batch)} — valid batches are ${LIBRARY_BATCHES.join(', ')}`)
  const b = batch as LibraryBatch
  const candidates = opts.candidates ?? DEFAULT_CANDIDATES[b]
  return LIBRARY.filter(e => e.category === BATCH_CATEGORY[b]).map(entry => {
    const boilerplate = itemBoilerplate(entry)
    const commissionText = itemCommission(entry)
    return { entry, boilerplate, commissionText, prompt: `${boilerplate} ${commissionText}`, candidates }
  })
}

// Two vision calls per item on the happy path: the sprite, then its icon.
export function estimateBatchCost(items: PlannedItem[]): number {
  return items.reduce((s, i) => s + i.candidates * EST_COST_PER_IMAGE + 2 * EST_COST_PER_VISION_CALL, 0)
}
