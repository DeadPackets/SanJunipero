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
/** How much of the wind is the gust the canopies lean to. The rest is the air that is always
 *  there, so the one voice with no single source still answers to something on screen. */
const WIND_GUST = 0.45
const RAIN_GAIN: Readonly<Record<string, number>> = { rain: 0.24, storm: 0.34 }
const FIRE_BASE = 0.09,
  FIRE_STEP = 0.045,
  FIRE_MAX = 0.2
/** A tone in the ear's own octave. At 0.2 it was the loudest thing the town ever did, and it
 *  did it all night. */
const CRICKET_MAX = 0.06
const MURMUR_BASE = 0.06,
  MURMUR_STEP = 0.03,
  MURMUR_MAX = 0.14
/** One strike, budgeted in the same table as everything else rather than inside the synth. */
const BELL_GAIN = 0.34

/** What the stage is showing, as far as anything audible is concerned. Every field is a thing
 *  the viewer can point at. */
export type SoundScene = {
  weatherKind: string
  minuteOfDay: number
  /** lit flames the camera can see, each counted by how near the middle of the frame it is */
  firesInView: number
  /** fireflies the camera can see — the crickets' own visible source */
  firefliesInView: number
  /** people in the open scene the camera can see, counted the same way the flames are */
  voicesInView: number
  /** where the fires sit across the frame, -1 hard left to 1 hard right */
  firePan?: number
  /** where the talking sits across the frame */
  voicePan?: number
  /** how hard the wind is blowing, 0 to 1: the number the canopies and the smoke lean to */
  gust?: number
  /** ms since the town ratified a law, or null if it has not */
  bellAgeMs: number | null
  /** which strike this is, so a second law inside the first one's tail rings again */
  bellStrike?: number
}

export type SoundCue = {
  source: SoundSource
  gain: number
  text: string
  pan: number
  strike: number
}

const cue = (source: SoundSource, gain: number, pan = 0, strike = 0): SoundCue => ({
  source,
  gain,
  text: cueChip(source),
  pan,
  strike,
})

/** ★ THE ONE LIST. The chips are drawn from it and the synth is handed it, so a sound the chips
 *  do not name cannot be played, and a chip with nothing behind it cannot be printed. */
export function soundCues(s: SoundScene): SoundCue[] {
  const out: SoundCue[] = []
  const gust = Math.min(1, Math.max(0, s.gust ?? 1))
  const air = WIND_BASE + (WIND_LEAN[s.weatherKind] ?? 0)
  out.push(cue('wind', air * (1 - WIND_GUST + WIND_GUST * gust)))
  const rain = RAIN_GAIN[s.weatherKind]
  if (rain !== undefined) out.push(cue('rain', rain))
  // the same clear night the swarm is out on, and the swarm is what the viewer can see of it
  const night = fireflyStrength(s.weatherKind, s.minuteOfDay)
  if (night > 0 && s.firefliesInView > 0) out.push(cue('crickets', CRICKET_MAX * night))
  if (s.firesInView > 0)
    out.push(cue('fire', Math.min(FIRE_MAX, FIRE_BASE + FIRE_STEP * s.firesInView), s.firePan ?? 0))
  if (s.voicesInView > 0)
    out.push(
      cue(
        'murmur',
        Math.min(MURMUR_MAX, MURMUR_BASE + MURMUR_STEP * s.voicesInView),
        s.voicePan ?? 0,
      ),
    )
  if (s.bellAgeMs !== null && s.bellAgeMs >= 0 && s.bellAgeMs < BELL_MS)
    out.push(cue('bell', BELL_GAIN, 0, s.bellStrike ?? 0))
  return out
}

// ── the mix ──────────────────────────────────────────────────────────────────────────────

/** ★ ONE NUMBER, ONE LOUDNESS. A-weighted against the wind's own band, so 0.06 of cricket at
 *  3.4 kHz and 0.12 of wind at 420 Hz mean the same thing to the ear that hears them. */
const EAR: Readonly<Record<SoundSource, number>> = {
  wind: 1,
  rain: 0.51,
  crickets: 0.5,
  fire: 0.77,
  murmur: 0.93,
  bell: 0.69,
}

/** How far the weather drops under an open scene or a bell, in dB. */
export const DUCK_DB = 7

/** The voices that give way. Nothing the frame is about is on this list. */
const BED: readonly SoundSource[] = ['wind', 'rain', 'crickets', 'fire']

export type SoundLevel = { source: SoundSource; gain: number; pan: number; strike: number }

/** ★ THE MIX, AND THE ONLY THING THAT WRITES A GAIN. The cue list is the budget in the ear's
 *  own units, and this is what it comes to once the frame has said what it is about. */
export function mixLevels(cues: readonly SoundCue[]): SoundLevel[] {
  const front = cues.some((c) => c.source === 'murmur' || c.source === 'bell')
  const duck = front ? 10 ** (-DUCK_DB / 20) : 1
  return cues.map((c) => ({
    source: c.source,
    gain: c.gain * EAR[c.source] * (BED.includes(c.source) ? duck : 1),
    pan: c.pan,
    strike: c.strike,
  }))
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
const LEVEL_KEY = 'sj.sound.level'

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

/** Loud enough to be worth unmuting, quiet enough that the town is never the loudest tab. */
export const DEFAULT_LEVEL = 0.7

/** ★ HOW LOUD, NOT WHETHER. A number the viewer sets, kept beside the switch rather than in it,
 *  so a town that is too loud has a remedy other than silence. */
export function soundLevel(storage: Pick<Storage, 'getItem'> | null): number {
  try {
    const said = storage?.getItem(LEVEL_KEY) ?? ''
    const n = Number(said)
    return said.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_LEVEL
  } catch {
    return DEFAULT_LEVEL
  }
}

export function rememberLevel(storage: Pick<Storage, 'setItem'> | null, v: number): void {
  try {
    storage?.setItem(LEVEL_KEY, String(v))
  } catch {
    /* as above: the choice holds for this page and is asked again on the next */
  }
}

export function storedLevel(): number {
  return soundLevel(localStore())
}

export function rememberStoredLevel(v: number): void {
  rememberLevel(localStore(), v)
}

/** ★ THE NIGHT FLOOR. A tab left open overnight is the case the sound is worst at, so after
 *  dark the master is held down whatever the slider says. */
export const NIGHT_LEVEL = 0.45
const NIGHT_FROM = 1260,
  NIGHT_TO = 360

export function masterFor(level: number, minuteOfDay: number): number {
  const dark = minuteOfDay >= NIGHT_FROM || minuteOfDay < NIGHT_TO
  const held = Math.min(1, Math.max(0, level))
  return SOUND_MASTER * (dark ? Math.min(held, NIGHT_LEVEL) : held)
}

// ── the synth ────────────────────────────────────────────────────────────────────────────

export type Soundscape = {
  setMuted(muted: boolean): void
  setHidden(hidden: boolean): void
  setMaster(gain: number): void
  play(cues: readonly SoundCue[]): void
  destroy(): void
}

const SILENT: Soundscape = {
  setMuted: () => undefined,
  setHidden: () => undefined,
  setMaster: () => undefined,
  play: () => undefined,
  destroy: () => undefined,
}

/** How fast a voice comes up or goes away. Long enough that a cue flickering on a frame
 *  boundary is a swell rather than a click. */
const RAMP_S = 0.35

/** Long enough for the master's fade to reach the floor before the clock stops, so a tab going
 *  away goes quiet rather than cutting. */
const SLEEP_MS = 700

/** The cricket, as chirps rather than a buzz: bursts of three, then better than a second of
 *  nothing, all of it scheduled on the audio clock. */
const CRICKET_HZ = 3400
const CHIRP_S = 0.03,
  CHIRP_GAP_S = 0.085,
  CHIRPS_PER_BURST = 3
const BURST_MIN_S = 1.2,
  BURST_VAR_S = 1.1
const AHEAD_S = 0.6,
  PUMP_MS = 220

/** Two seconds of white noise, generated once and looped: the material wind, rain, fire and a
 *  murmur are all cut from, each through its own filter. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

type Voice = { gain: GainNode; pan: StereoPannerNode | null; shape: GainNode | null }

function createSoundscape(): Soundscape {
  const wake = (): AudioContext | null => {
    if (typeof AudioContext === 'undefined') return null
    return new AudioContext()
  }
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let bus: DynamicsCompressorNode | null = null
  const voices = new Map<SoundSource, Voice>()
  let struck = 0
  let muted = true
  let hidden = false
  let level = SOUND_MASTER
  let held: readonly SoundCue[] = []
  let chirpAt = 0
  let pumping: ReturnType<typeof setInterval> | null = null
  let nap: ReturnType<typeof setTimeout> | null = null

  /** One filtered tap off the shared noise loop. Built once, per source, on the first unmute. */
  const noiseVoice = (
    c: AudioContext,
    out: AudioNode,
    buffer: AudioBuffer,
    type: BiquadFilterType,
    hz: number,
    q: number,
    placed: boolean,
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
    const pan = placed ? c.createStereoPanner() : null
    src.connect(filter).connect(gain)
    if (pan === null) gain.connect(out)
    else gain.connect(pan).connect(out)
    src.start()
    return { gain, pan, shape: null }
  }

  /** One high tone held open by a scheduled envelope, so what the ear gets is chirps and the
   *  timing belongs to the audio clock rather than to a render. */
  const cricketVoice = (c: AudioContext, out: AudioNode): Voice => {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = CRICKET_HZ
    const shape = c.createGain()
    shape.gain.value = 0
    const gain = c.createGain()
    gain.gain.value = 0
    osc.connect(shape).connect(gain).connect(out)
    osc.start()
    return { gain, pan: null, shape }
  }

  const build = (c: AudioContext, out: AudioNode): void => {
    const noise = noiseBuffer(c)
    voices.set('wind', noiseVoice(c, out, noise, 'lowpass', 420, 0.7, false))
    voices.set('rain', noiseVoice(c, out, noise, 'highpass', 1300, 0.6, false))
    voices.set('fire', noiseVoice(c, out, noise, 'bandpass', 680, 0.8, true))
    voices.set('murmur', noiseVoice(c, out, noise, 'bandpass', 480, 3.2, true))
    voices.set('crickets', cricketVoice(c, out))
  }

  /** The bell is the one voice with no steady state: two partials on the bell's own ratio,
   *  struck once at the gain the cue asked for and left to decay. */
  const ring = (c: AudioContext, out: AudioNode, gain: number): void => {
    const now = c.currentTime
    for (const [hz, part] of [
      [784, 1],
      [784 * 2.76, 0.36],
    ] as const) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = hz
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * part), now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + BELL_MS / 1000)
      osc.connect(g).connect(out)
      osc.start(now)
      osc.stop(now + BELL_MS / 1000)
    }
  }

  /** Fills the next moment of chirps. Gaps are drawn per burst, so no two nights are the same
   *  train of clicks. */
  const chirps = (c: AudioContext): void => {
    const shape = voices.get('crickets')?.shape
    if (shape === undefined || shape === null) return
    if (!held.some((v) => v.source === 'crickets')) return
    const until = c.currentTime + AHEAD_S
    if (chirpAt < c.currentTime) chirpAt = c.currentTime + 0.05
    while (chirpAt < until) {
      for (let i = 0; i < CHIRPS_PER_BURST; i++) {
        const t = chirpAt + i * CHIRP_GAP_S
        shape.gain.setValueAtTime(0, t)
        shape.gain.linearRampToValueAtTime(1, t + 0.006)
        shape.gain.linearRampToValueAtTime(0, t + CHIRP_S)
      }
      chirpAt += CHIRPS_PER_BURST * CHIRP_GAP_S + BURST_MIN_S + Math.random() * BURST_VAR_S
    }
  }

  const awake = (): boolean => ctx !== null && !muted && !hidden

  const beat = (): void => {
    if (awake() && pumping === null)
      pumping = setInterval(() => {
        if (ctx !== null) chirps(ctx)
      }, PUMP_MS)
    if (!awake() && pumping !== null) {
      clearInterval(pumping)
      pumping = null
    }
  }

  const at = (v: Voice, target: number, pan: number): void => {
    if (ctx === null) return
    v.gain.gain.setTargetAtTime(target, ctx.currentTime, RAMP_S / 3)
    v.pan?.pan.setTargetAtTime(pan, ctx.currentTime, RAMP_S / 3)
  }

  const write = (levels: readonly SoundLevel[]): void => {
    const wanted = new Map(levels.map((l) => [l.source, l]))
    for (const [source, voice] of voices) {
      const l = wanted.get(source)
      at(voice, l?.gain ?? 0, l?.pan ?? 0)
    }
  }

  const writeMaster = (): void => {
    if (ctx === null || master === null) return
    master.gain.setTargetAtTime(awake() ? level : 0, ctx.currentTime, RAMP_S / 3)
  }

  /** ★ THE VOICES FIRST, THEN THE MASTER. A still night moves no gain for eight sim-hours, and
   *  a master raised over a mix nobody has written since dusk lands the whole bed at once. */
  const settle = (): void => {
    if (ctx === null) return
    if (awake()) {
      if (nap !== null) clearTimeout(nap)
      nap = null
      void ctx.resume()
      write(mixLevels(held))
      writeMaster()
    } else {
      writeMaster()
      if (nap !== null) clearTimeout(nap)
      // muted or away, the graph goes on synthesizing until the clock itself is stopped
      nap = setTimeout(() => {
        void ctx?.suspend()
      }, SLEEP_MS)
    }
    beat()
  }

  return {
    setMuted(next) {
      muted = next
      if (!muted && ctx === null) {
        ctx = wake()
        if (ctx === null) return
        master = ctx.createGain()
        master.gain.value = 0
        bus = ctx.createDynamicsCompressor()
        bus.threshold.value = -18
        bus.knee.value = 12
        bus.ratio.value = 4
        bus.attack.value = 0.005
        bus.release.value = 0.25
        bus.connect(master).connect(ctx.destination)
        build(ctx, bus)
      }
      settle()
    },
    setHidden(next) {
      hidden = next
      settle()
    },
    setMaster(gain) {
      level = gain
      writeMaster()
    },
    play(cues) {
      held = cues
      if (ctx === null) return
      const levels = mixLevels(cues)
      write(levels)
      const bell = levels.find((l) => l.source === 'bell')
      if (bell !== undefined && bell.strike !== struck) {
        if (awake() && bus !== null) ring(ctx, bus, bell.gain)
        struck = bell.strike
      }
    },
    destroy() {
      if (pumping !== null) clearInterval(pumping)
      if (nap !== null) clearTimeout(nap)
      pumping = null
      nap = null
      voices.clear()
      void ctx?.close()
      ctx = null
      master = null
      bus = null
    },
  }
}

/** A runtime with no WebAudio — a server render, a browser with it switched off — gets a handle
 *  that answers every call and makes no sound. */
export function soundscapeOrSilence(): Soundscape {
  return typeof AudioContext === 'undefined' ? SILENT : createSoundscape()
}
