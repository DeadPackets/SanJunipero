import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, flamesAt } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { rectInView, type ViewRect } from '../render/cull.js'
import { feetOf } from '../render/iso.js'
import { poolCentre } from '../render/lightPools.js'
import { FIREFLY_MAX, fireflySeeds, fireflyStrength } from '../render/fireflies.js'
import {
  BELL_MS,
  CUE_CHIP_MS,
  cueChip,
  rememberStoredSound,
  soundCues,
  soundscapeOrSilence,
  standingChips,
  storedSound,
  trackStarts,
  type CueStart,
  type SoundScene,
  type Soundscape as Synth,
} from '../ui/sound.js'
import { SoundButton } from './SoundButton.js'

const NOTHING_IN_VIEW: ViewRect = { x: 0, y: 0, w: 0, h: 0 }
const inView = (view: ViewRect, sx: number, sy: number): boolean => rectInView(sx, sy, sx, sy, view)

/** ★ THE TOWN, HEARD AND READ. One list drives both halves: the chips print it and the synth
 *  plays it, so the signal survives a viewer who never unmutes — which is every viewer by
 *  default. The stack is column-reverse, so a bell arriving on top leaves the rest where they
 *  were rather than shoving the whole corner up a row. */
export function Soundscape({ store, scene }: { store: WorldStore; scene: Scene | null }) {
  const [setting, setSetting] = useState(storedSound)
  const synth = useRef<Synth | null>(null)
  const [bellAt, setBellAt] = useState<number | null>(null)
  // Deltas arrive at most four times a second, so this component re-renders at that rate and
  // never at the camera's: the canvas is asked what it can see, it is not driven from here.
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  useEffect(() => {
    const s = soundscapeOrSilence()
    synth.current = s
    return () => {
      s.destroy()
      synth.current = null
    }
  }, [])

  useEffect(
    () =>
      store.onEvents((evts) => {
        if (evts.some((e) => e.type === 'law_ratified')) setBellAt(performance.now())
      }),
    [store],
  )

  // The chip goes when the ring does: without this the row would stand until the next snapshot.
  useEffect(() => {
    if (bellAt === null) return
    const id = setTimeout(() => {
      setBellAt(null)
    }, BELL_MS)
    return () => {
      clearTimeout(id)
    }
  }, [bellAt])

  const seeds = useMemo(
    () => (state === null ? [] : fireflySeeds(state.terrain, FIREFLY_MAX)),
    [state],
  )

  const cues = useMemo(() => {
    if (state === null) return []
    const view = scene?.viewRect() ?? NOTHING_IN_VIEW
    const tick = store.getTick()
    const minuteOfDay = tick % MINUTES_PER_DAY
    let firesInView = 0
    for (const f of flamesAt(state, tick, store.getConfig() ?? DEFAULT_CONFIG)) {
      const at = poolCentre(f)
      if (inView(view, at.sx, at.sy)) firesInView++
    }
    let firefliesInView = 0
    if (fireflyStrength(state.weather.kind, minuteOfDay) > 0)
      for (const s of seeds) {
        const at = feetOf(s.x, s.y)
        if (inView(view, at.sx, at.sy)) firefliesInView++
      }
    const held = store.getScene()
    let voicesInView = 0
    if (held?.open)
      for (const id of held.participants) {
        const a = state.agents[id]
        if (a === undefined) continue
        const at = feetOf(a.x, a.y)
        if (inView(view, at.sx, at.sy)) voicesInView++
      }
    const world: SoundScene = {
      weatherKind: state.weather.kind,
      minuteOfDay,
      firesInView,
      firefliesInView,
      voicesInView,
      // The strike is the synth's to shape; the render only says whether a bell is ringing.
      bellAgeMs: bellAt === null ? null : 0,
    }
    return soundCues(world)
  }, [state, scene, store, seeds, bellAt])

  // The gains are what the synth is given, so a mix that moved is a new effect and a mix that
  // did not is no work at all.
  const mix = cues.map((c) => `${c.source}:${c.gain.toFixed(3)}`).join('|')
  useEffect(() => {
    synth.current?.play(cues)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mix` IS the cue list, compared by value; the array identity changes on every snapshot.
  }, [mix])

  // The same list stamps the chips. One book, so a voice the synth starts cannot start unnamed.
  const [book, setBook] = useState<readonly CueStart[]>([])
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const at = performance.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the mix is the external thing this stamps; the book is its ledger, not a value derivable from props.
    setBook((prev) => trackStarts(prev, cues, at))
    setNow(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above: `mix` is the value the cue list carries.
  }, [mix])
  const chips = standingChips(book, now)
  // The store is what re-renders this and a paused town stops sending, so the clock walks itself
  // to the next chip's own expiry — and to nothing in between.
  const nextOut = chips.length === 0 ? null : Math.min(...chips.map((c) => c.sinceMs)) + CUE_CHIP_MS
  useEffect(() => {
    if (nextOut === null) return
    const id = setTimeout(
      () => {
        setNow(performance.now())
      },
      Math.max(16, nextOut - performance.now()),
    )
    return () => {
      clearTimeout(id)
    }
  }, [nextOut])

  const onToggle = useCallback(() => {
    setSetting((prev) => {
      const next = prev === 'on' ? 'muted' : 'on'
      rememberStoredSound(next)
      // The context is opened inside the click, which is the gesture the autoplay policy wants.
      synth.current?.setMuted(next === 'muted')
      return next
    })
  }, [])

  return (
    <>
      <SoundButton setting={setting} onToggle={onToggle} />
      <ul className="sound-cues" aria-label="What the town has begun to sound like">
        {chips.map((c) => (
          <li className="sound-cue" key={c.source}>
            {cueChip(c.source)}
          </li>
        ))}
      </ul>
    </>
  )
}
