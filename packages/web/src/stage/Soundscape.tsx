import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, flamesAt } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { rectInView, type ViewRect } from '../render/cull.js'
import { feetOf } from '../render/iso.js'
import { poolCentre } from '../render/lightPools.js'
import { FIREFLY_MAX, fireflySeeds, fireflyStrength } from '../render/fireflies.js'
import { windNow } from '../render/wind.js'
import {
  BELL_MS,
  CUE_CHIP_MS,
  cueChip,
  masterFor,
  rememberStoredLevel,
  rememberStoredSound,
  soundCues,
  soundscapeOrSilence,
  standingChips,
  storedLevel,
  storedSound,
  trackStarts,
  type CueStart,
  type SoundScene,
  type Soundscape as Synth,
} from '../ui/sound.js'
import { SoundButton } from './SoundButton.js'

const NOTHING_IN_VIEW: ViewRect = { x: 0, y: 0, w: 0, h: 0 }
const inView = (view: ViewRect, sx: number, sy: number): boolean => rectInView(sx, sy, sx, sy, view)

/** How far past the frame's own half-width a sound still carries. A source at the corner is
 *  down to a tenth of one under the lens, so a cut is a fade and never a step. */
const REACH = 1.6

/** ★ A SOUND HAS A PLACE. How much of a source at this point on the screen reaches the viewer,
 *  and where it sits across the frame, so the camera moves the mix instead of stepping it. */
export function heard(view: ViewRect, sx: number, sy: number): { near: number; pan: number } {
  const hw = Math.max(1, view.w / 2),
    hh = Math.max(1, view.h / 2)
  const dx = (sx - (view.x + hw)) / hw,
    dy = (sy - (view.y + hh)) / hh
  return {
    near: Math.max(0, 1 - Math.hypot(dx, dy) / REACH),
    pan: Math.max(-1, Math.min(1, dx)),
  }
}

/** The slider hangs off the note, so how loud is answered where whether is. */
const LEVEL_CSS = `
.sound-level {
  position: absolute; z-index: 25; margin: 0;
  left: calc(max(var(--mark-inset), env(safe-area-inset-left)) + 44px + var(--s-2));
  bottom: calc(max(var(--mark-inset), env(safe-area-inset-bottom)) + 88px + 2 * var(--s-3));
  width: 88px; height: 44px;
  accent-color: var(--honey); cursor: pointer;
}
.sound-level:focus-visible { outline: 2px solid var(--honey); outline-offset: 2px; }
[data-broadcast='on'] .sound-level, [data-paper='on'] .sound-level { display: none; }
`

/** ★ THE TOWN, HEARD AND READ. One list drives both halves: the chips print it and the synth
 *  plays it, so the signal survives a viewer who never unmutes — which is every viewer by
 *  default. The stack is column-reverse, so a bell arriving on top leaves the rest where they
 *  were rather than shoving the whole corner up a row. */
export function Soundscape({ store, scene }: { store: WorldStore; scene: Scene | null }) {
  const [setting, setSetting] = useState(storedSound)
  const [level, setLevel] = useState(storedLevel)
  const synth = useRef<Synth | null>(null)
  const [bell, setBell] = useState<{ strike: number } | null>(null)
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

  // A tab nobody is looking at keeps its socket for fifteen seconds and its sound forever, so
  // the fade and the clock are stopped here rather than waited for.
  useEffect(() => {
    const onShow = (): void => {
      synth.current?.setHidden(document.hidden)
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])

  useEffect(
    () =>
      store.onEvents((evts) => {
        const seen = evts.some((e) => {
          if (e.type !== 'law_ratified') return false
          const who = (e.payload as { agentId?: string }).agentId
          const body = who === undefined ? undefined : store.getState()?.agents[who]
          if (body === undefined) return false
          const at = feetOf(body.x, body.y)
          return inView(scene?.viewRect() ?? NOTHING_IN_VIEW, at.sx, at.sy)
        })
        // Every strike is its own number, so a second law inside the first one's tail rings.
        if (seen) setBell((prev) => ({ strike: (prev?.strike ?? 0) + 1 }))
      }),
    [store, scene],
  )

  // The chip goes when the ring does: without this the row would stand until the next snapshot.
  useEffect(() => {
    if (bell === null) return
    const id = setTimeout(() => {
      setBell(null)
    }, BELL_MS)
    return () => {
      clearTimeout(id)
    }
  }, [bell])

  const terrain = state?.terrain ?? null
  const seeds = useMemo(
    () => (terrain === null ? [] : fireflySeeds(terrain, FIREFLY_MAX)),
    [terrain],
  )

  const tick = store.getTick()
  const minuteOfDay = tick % MINUTES_PER_DAY
  const gust = Math.abs(windNow())

  const cues = useMemo(() => {
    if (state === null) return []
    const view = scene?.viewRect() ?? NOTHING_IN_VIEW
    let fires = 0,
      firePan = 0
    for (const f of flamesAt(state, tick, store.getConfig() ?? DEFAULT_CONFIG)) {
      const at = poolCentre(f)
      if (!inView(view, at.sx, at.sy)) continue
      const from = heard(view, at.sx, at.sy)
      fires += from.near
      firePan += from.near * from.pan
    }
    let firefliesInView = 0
    if (fireflyStrength(state.weather.kind, minuteOfDay) > 0)
      for (const s of seeds) {
        const at = feetOf(s.x, s.y)
        if (inView(view, at.sx, at.sy)) firefliesInView++
      }
    let mouths = 0,
      voicePan = 0
    for (const held of store.openScenes())
      for (const id of held.participants) {
        const a = state.agents[id]
        if (a === undefined) continue
        const at = feetOf(a.x, a.y)
        if (!inView(view, at.sx, at.sy)) continue
        const from = heard(view, at.sx, at.sy)
        mouths += from.near
        voicePan += from.near * from.pan
      }
    const world: SoundScene = {
      weatherKind: state.weather.kind,
      minuteOfDay,
      firesInView: fires,
      firefliesInView,
      voicesInView: mouths,
      firePan: fires > 0 ? firePan / fires : 0,
      voicePan: mouths > 0 ? voicePan / mouths : 0,
      gust,
      // The strike is the synth's to shape; the render only says whether a bell is ringing.
      bellAgeMs: bell === null ? null : 0,
      bellStrike: bell?.strike ?? 0,
    }
    return soundCues(world)
  }, [state, scene, store, seeds, bell, tick, minuteOfDay, gust])

  // ★ EVERY SNAPSHOT, NOT EVERY CHANGE. A still night moves no gain for eight sim-hours, and a
  // synth written only when the numbers move plays that whole night in one go at dawn.
  useEffect(() => {
    synth.current?.play(cues)
  }, [cues])

  const master = masterFor(level, minuteOfDay)
  useEffect(() => {
    synth.current?.setMaster(master)
  }, [master])

  // The same list stamps the chips, and a chip answers to the WORDS rather than to the gains:
  // a fire crossing the frame moves the mix every snapshot and is still one fire.
  const named = cues.map((c) => c.source).join('|')
  const [book, setBook] = useState<readonly CueStart[]>([])
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const at = performance.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the mix is the external thing this stamps; the book is its ledger, not a value derivable from props.
    setBook((prev) => trackStarts(prev, cues, at))
    setNow(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `named` IS the cue list's own roll call, compared by value. The array identity changes on every snapshot.
  }, [named])
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

  const onLevel = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setLevel(v)
    rememberStoredLevel(v)
  }, [])

  return (
    <>
      <style>{LEVEL_CSS}</style>
      <SoundButton setting={setting} onToggle={onToggle} />
      {setting === 'on' && (
        <input
          className="sound-level"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={level}
          aria-label="How loud the town is"
          onChange={onLevel}
        />
      )}
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
