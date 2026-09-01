import { sanitizeSpokenText } from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { kindWords } from './broadcastReady.js'
import { plateRows, type PlateRow } from './plateModel.js'
import { stateWord } from './status.js'

export type HoverKind = 'agent' | 'structure' | 'item' | 'crop'

/** What Escape puts down. The ring is not a rung of its own: it IS the pick's chrome, so it
 *  goes down with the pick. */
export type EscapeRung = 'keys' | 'paper' | 'interior' | 'subject' | 'fullscreen'

export type StageUp = Readonly<Record<EscapeRung, boolean>>

/** ONE ladder, topmost first — every Escape in the app resolves through this and nothing else. */
export function escapeStep(up: StageUp): EscapeRung | null {
  if (up.keys) return 'keys'
  if (up.paper) return 'paper'
  if (up.interior) return 'interior'
  if (up.subject) return 'subject'
  return up.fullscreen ? 'fullscreen' : null
}

export const CROP_STAGES = 4

// Typographic apostrophe — the chrome sets prose, not code.
const OWNS = '’s'

function agentName(state: WorldState, id: string): string {
  return state.agents[id]?.name ?? id
}

/** What the town calls a building, everywhere a viewer reads its name: the name a hand carved
 *  into it, then the words of the inscription, and only then the kind it is. It takes the
 *  building, not an id, so no caller has a not-there case to invent an answer for. */
export function structureTitle(s: Structure): string {
  // A carved word is one mind's text landing in another's eye, so it goes through the same
  // sanitizer `placeName` names a place with. R4: a hover used to read "fire_pit".
  const written = s.name ?? s.inscription?.text
  const carved = written === undefined ? '' : sanitizeSpokenText(written)
  return carved === '' ? kindWords(s.kind) : carved
}

/** A viewer is never shown an id: genesis signs its own work with a runner who is nobody, so an
 *  owner outside the town is left unsaid rather than printed. */
function ownedBy(state: WorldState, ownerId: string | undefined): string | null {
  if (ownerId === undefined) return null
  const owner = state.agents[ownerId]
  return owner === undefined ? null : `${owner.name}${OWNS}`
}

/** Who is under this roof, in the town's own words. Two names read as names; a crowd is a count,
 *  because the plate has one line for it either way. */
function whoIsInside(state: WorldState, structureId: string): string | null {
  const names: string[] = []
  for (const a of Object.values(state.agents)) {
    if (a.alive && a.insideId === structureId) names.push(a.name)
  }
  if (names.length === 0) return null
  names.sort()
  if (names.length > 2) return `${names.length} inside`
  return `${names.join(' & ')} inside`
}

// ★ THE FOOTPRINT PLATE'S WORDS — what this is, whose it is, and what is happening. Three lines
// at most, and a line with nothing to say is not drawn at all. Named apart from
// charAnim's nameTagText(name), which is the sprite tag itself.
export function hoverPlate(state: WorldState | null, kind: HoverKind, id: string): PlateRow[] {
  if (state === null) return []
  switch (kind) {
    case 'agent': {
      const a = state.agents[id]
      // A person's plate is their name and the one word for what they are doing.
      return a === undefined
        ? []
        : plateRows([
            { text: a.name, tone: 'name' },
            { text: stateWord(a, state.tick), tone: 'quiet' },
          ])
    }
    case 'structure': {
      const s = state.structures[id]
      if (s === undefined) return []
      const kindWord = kindWords(s.kind)
      const title = structureTitle(s)
      const owner = ownedBy(state, s.owner)
      // The title is the carved name when there is one; when there is not, `structureTitle`
      // gives back the kind, which line one already said — so the owner takes the line.
      const named = title === kindWord ? null : title
      return plateRows([
        { text: kindWord, tone: 'kind' },
        { text: named ?? owner ?? '', tone: 'name' },
        { text: whoIsInside(state, s.id) ?? (named === null ? '' : (owner ?? '')), tone: 'quiet' },
      ])
    }
    case 'item': {
      const it = state.items[id]
      if (it === undefined) return []
      const owner = ownedBy(state, it.owner)
      return plateRows([
        { text: kindWords(it.kind), tone: 'kind' },
        { text: `×${it.qty}${owner === null ? '' : ` · ${owner}`}`, tone: 'quiet' },
      ])
    }
    case 'crop': {
      const c = state.crops[id]
      if (c === undefined) return []
      return plateRows([
        { text: kindWords(c.kind), tone: 'kind' },
        {
          text: c.withered ? 'withered' : `stage ${c.stage} of ${CROP_STAGES}`,
          tone: 'quiet',
        },
      ])
    }
  }
}

/** A structure is not here: it has a place of its own, with its whole provenance on it. */
export function itemCropDetail(
  state: WorldState | null,
  thing: { kind: 'item' | 'crop'; id: string },
): string | null {
  if (state === null) return null
  if (thing.kind === 'item') {
    const it = state.items[thing.id]
    if (it === undefined) return null
    const owner =
      it.owner === undefined ? 'claimed by no one' : `owned by ${agentName(state, it.owner)}`
    return `${kindWords(it.kind)} ×${it.qty}, ${owner}`
  }
  const c = state.crops[thing.id]
  if (c === undefined) return null
  const growth = c.withered ? 'withered' : `stage ${c.stage} of ${CROP_STAGES}`
  return `${kindWords(c.kind)}, planted on day ${c.plantedDay}, ${growth}`
}

export function thingKind(
  state: WorldState | null,
  thing: { kind: 'item' | 'crop'; id: string },
): string | null {
  if (state === null) return null
  return (thing.kind === 'item' ? state.items[thing.id]?.kind : state.crops[thing.id]?.kind) ?? null
}
