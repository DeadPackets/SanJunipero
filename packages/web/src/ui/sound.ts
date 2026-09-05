import { fireflyStrength } from '../render/fireflies.js'
import { localStore } from './storage.js'

// ★ THE TOWN, HEARD. Opt-in, diegetic and synthesized: every voice below is a source the viewer
// can see on the stage, and every one of them also prints a cue chip — so a muted viewer, which
// is every viewer until they say otherwise, loses the sound and keeps the signal.

/** In the order the chips stack, bottom-up: the news at the top, the weather underneath. */
export const SOUND_SOURCES = ['wind', 'rain', 'crickets', 'fire', 'murmur', 'bell'] as const
export type SoundSource = (typeof SOUND_SOURCES)[number]

/** What a chip says. Plain words, because the point of the chip is to be read. */
export const CUE_WORD: Readonly<Record<SoundSource, string>> = {
  wind: 'wind',
  rain: 'rain',
  crickets: 'crickets',
  fire: 'a fire',
  murmur: 'voices',
  bell: 'a bell',
}

export function cueChip(source: SoundSource): string {
  return `♪ ${CUE_WORD[source]}`
}

/** How long a ratified law's bell rings for, tail included. */
export const BELL_MS = 2400

/** The whole mix goes through this. The loudest world sums to 0.96 before it, so nothing the
 *  town can do reaches the clipping point. */
export const SOUND_MASTER = 0.55

// Gains, chosen so the loudest possible world — a storm, at night, over a fire, in a scene —
// sums to under one. Every number here is a measured budget, not a taste.
const WIND_BASE = 0.12
const WIND_LEAN: Readonly<Record<string, number>> = {
  storm: 0.16,
  rain: 0.1,
  cloudy: 0.06,
  snow: 0.06,
}
const RAIN_GAIN: Readonly<Record<string, number>> = { rain: 0.24, storm: 0.34 }
const FIRE_BASE = 0.09,
  FIRE_STEP = 0.045,
  FIRE_MAX = 0.2
const CRICKET_MAX = 0.2
const MURMUR_BASE = 0.06,
  MURMUR_STEP = 0.03,
  MURMUR_MAX = 0.14

/** What the stage is showing, as far as anything audible is concerned. Every field is a thing
 *  the viewer can point at. */
export type SoundScene = {
  weatherKind: string
  minuteOfDay: number
  /** lit flames the camera can see */
  firesInView: number
  /** fireflies the camera can see — the crickets' own visible source */
  firefliesInView: number
  /** people in the open scene the camera can see */
  voicesInView: number
  /** ms since the town ratified a law, or null if it has not */
  bellAgeMs: number | null
}

export type SoundCue = { source: SoundSource; gain: number; text: string }

const cue = (source: SoundSource, gain: number): SoundCue => ({
  source,
  gain,
  text: cueChip(source),
})

/** ★ THE ONE LIST. The chips are drawn from it and the synth is handed it, so a sound the chips
 *  do not name cannot be played, and a chip with nothing behind it cannot be printed. */
export function soundCues(s: SoundScene): SoundCue[] {
  const out: SoundCue[] = []
  out.push(cue('wind', WIND_BASE + (WIND_LEAN[s.weatherKind] ?? 0)))
  const rain = RAIN_GAIN[s.weatherKind]
  if (rain !== undefined) out.push(cue('rain', rain))
  // the same clear night the swarm is out on, and the swarm is what the viewer can see of it
  const night = fireflyStrength(s.weatherKind, s.minuteOfDay)
  if (night > 0 && s.firefliesInView > 0) out.push(cue('crickets', CRICKET_MAX * night))
  if (s.firesInView > 0)
    out.push(cue('fire', Math.min(FIRE_MAX, FIRE_BASE + FIRE_STEP * s.firesInView)))
  if (s.voicesInView > 0)
    out.push(cue('murmur', Math.min(MURMUR_MAX, MURMUR_BASE + MURMUR_STEP * s.voicesInView)))
  if (s.bellAgeMs !== null && s.bellAgeMs >= 0 && s.bellAgeMs < BELL_MS) out.push(cue('bell', 1))
  return out
}

// ── the chips ────────────────────────────────────────────────────────────────────────────

/** How long a chip stands after its sound starts. The sun arc is the one PERMANENT mark over
 *  the town, so a running voice is not chrome: what the town has just begun to sound like is. */
export const CUE_CHIP_MS = 4200

/** When each voice in the mix last started. A voice that stops is forgotten, so coming back is
 *  a new start and earns a new chip. */
export type CueStart = { source: SoundSource; sinceMs: number }

export function trackStarts(
  prev: readonly CueStart[],
  cues: readonly SoundCue[],
  nowMs: number,
): CueStart[] {
  return cues.map((c) => ({
    source: c.source,
    sinceMs: prev.find((p) => p.source === c.source)?.sinceMs ?? nowMs,
  }))
}

/** ★ A CHIP FOR EVERY START, AND FOR NOTHING ELSE. `trackStarts` stamps a voice the moment it
 *  enters the mix, so a sound the synth begins always has its word on screen — which is the
 *  whole of what a muted viewer gets. */
export function standingChips(book: readonly CueStart[], nowMs: number): CueStart[] {
  return book.filter((s) => nowMs - s.sinceMs < CUE_CHIP_MS)
}

// ── the setting ──────────────────────────────────────────────────────────────────────────

const SETTINGS = ['muted', 'on'] as const
export type SoundSetting = (typeof SETTINGS)[number]
const SOUND_KEY = 'sj.sound'

/** Muted is the answer to every question this cannot answer: a browser that blocks site data,
 *  a word a later build wrote, a viewer who has never been asked. */
export function soundSetting(storage: Pick<Storage, 'getItem'> | null): SoundSetting {
  try {
    const said = storage?.getItem(SOUND_KEY)
    return SETTINGS.find((s) => s === said) ?? 'muted'
  } catch {
    return 'muted'
  }
}

export function rememberSound(storage: Pick<Storage, 'setItem'> | null, v: SoundSetting): void {
  try {
    storage?.setItem(SOUND_KEY, v)
  } catch {
    /* nothing to do: the choice holds for this page and is asked again on the next */
  }
}

export function storedSound(): SoundSetting {
  return soundSetting(localStore())
}

export function rememberStoredSound(v: SoundSetting): void {
  rememberSound(localStore(), v)
}

// ── the synth ────────────────────────────────────────────────────────────────────────────

export type Soundscape = {
  setMuted(muted: boolean): void
  play(cues: readonly SoundCue[]): void
  destroy(): void
}

const SILENT: Soundscape = { setMuted: () => {}, play: () => {}, destroy: () => {} }

/** How fast a voice comes up or goes away. Long enough that a cue flickering on a frame
 *  boundary is a swell rather than a click. */
const RAMP_S = 0.35

/** Two seconds of white noise, generated once and looped: the material wind, rain, fire and a
 *  murmur are all cut from, each through its own filter. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

type Voice = { gain: GainNode }

function createSoundscape(): Soundscape {
  const wake = (): AudioContext | null => {
    if (typeof AudioContext === 'undefined') return null
    return new AudioContext()
  }
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  const voices = new Map<SoundSource, Voice>()
  let bellRinging = false
  let muted = true

  /** One filtered tap off the shared noise loop. Built once, per source, on the first unmute. */
  const noiseVoice = (
    c: AudioContext,
    out: GainNode,
    buffer: AudioBuffer,
    type: BiquadFilterType,
    hz: number,
    q: number,
  ): Voice => {
    const src = c.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = c.createBiquadFilter()
    filter.type = type
    filter.frequency.value = hz
    filter.Q.value = q
    const gain = c.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(out)
    src.start()
    return { gain }
  }

  /** A chirp train: one high tone gated by a slow square, which is what a cricket is. */
  const cricketVoice = (c: AudioContext, out: GainNode): Voice => {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 4400
    const chirp = c.createOscillator()
    chirp.type = 'square'
    chirp.frequency.value = 2.4 // under the 3 Hz photosensitive band the lights are held to
    const depth = c.createGain()
    depth.gain.value = 0.5
    const gate = c.createGain()
    gate.gain.value = 0.5
    chirp.connect(depth).connect(gate.gain)
    const gain = c.createGain()
    gain.gain.value = 0
    osc.connect(gate).connect(gain).connect(out)
    osc.start()
    chirp.start()
    return { gain }
  }

  const build = (c: AudioContext, out: GainNode): void => {
    const noise = noiseBuffer(c)
    voices.set('wind', noiseVoice(c, out, noise, 'lowpass', 420, 0.7))
    voices.set('rain', noiseVoice(c, out, noise, 'highpass', 1300, 0.6))
    voices.set('fire', noiseVoice(c, out, noise, 'bandpass', 680, 0.8))
    voices.set('murmur', noiseVoice(c, out, noise, 'bandpass', 480, 3.2))
    voices.set('crickets', cricketVoice(c, out))
  }

  /** The bell is the one voice with no steady state: two partials on the bell's own ratio,
   *  struck once and left to decay. */
  const ring = (c: AudioContext, out: GainNode): void => {
    const now = c.currentTime
    for (const [hz, level] of [
      [784, 0.5],
      [784 * 2.76, 0.18],
    ] as const) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = hz
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(level, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + BELL_MS / 1000)
      osc.connect(g).connect(out)
      osc.start(now)
      osc.stop(now + BELL_MS / 1000)
    }
  }

  const at = (v: Voice, target: number): void => {
    if (ctx === null) return
    v.gain.gain.setTargetAtTime(target, ctx.currentTime, RAMP_S / 3)
  }

  return {
    setMuted(next) {
      muted = next
      if (muted) {
        if (master !== null && ctx !== null)
          master.gain.setTargetAtTime(0, ctx.currentTime, RAMP_S / 3)
        return
      }
      if (ctx === null) {
        ctx = wake()
        if (ctx === null) return
        master = ctx.createGain()
        master.gain.value = 0
        master.connect(ctx.destination)
        build(ctx, master)
      }
      void ctx.resume()
      master?.gain.setTargetAtTime(SOUND_MASTER, ctx.currentTime, RAMP_S / 3)
    },
    play(cues) {
      if (ctx === null || muted) return
      const wanted = new Map(cues.map((c) => [c.source, c.gain]))
      for (const [source, voice] of voices) at(voice, wanted.get(source) ?? 0)
      const bell = wanted.has('bell')
      if (bell && !bellRinging && master !== null) ring(ctx, master)
      bellRinging = bell
    },
    destroy() {
      voices.clear()
      void ctx?.close()
      ctx = null
      master = null
    },
  }
}

/** A runtime with no WebAudio — a server render, a browser with it switched off — gets a handle
 *  that answers every call and makes no sound. */
export function soundscapeOrSilence(): Soundscape {
  return typeof AudioContext === 'undefined' ? SILENT : createSoundscape()
}
