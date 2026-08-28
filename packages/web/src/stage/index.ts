// W1 replaces this file at merge — signatures only, nothing is drawn.
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'

export type Subject = { id: string; kind: 'agent' | 'structure'; name: string }
export type RingVerb = 'follow' | 'story' | 'bonds' | 'home'

export function SubjectRing(_props: {
  subject: Subject | null
  scene: Scene | null
  onVerb: (verb: RingVerb) => void
}): null {
  return null
}

export function Nameplate(_props: { subject: Subject | null; scene: Scene | null }): null {
  return null
}

export function QuietStamp(_props: { store: WorldStore }): null {
  return null
}

export function DirectorCue(_props: { text: string | null }): null {
  return null
}

export function SpeechLive(_props: { store: WorldStore }): null {
  return null
}

export function useStageKeys(_handlers: {
  onSignpost: () => void
  onEscape: () => void
  onFullscreen: () => void
  onDirector: () => void
}): void {
  /* W1 owns the key map */
}
