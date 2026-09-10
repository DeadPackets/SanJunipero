import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SoundButton } from '../stage/SoundButton.js'
import {
  BELL_MS,
  CUE_CHIP_MS,
  CUE_WORD,
  DEFAULT_LEVEL,
  DUCK_DB,
  NIGHT_LEVEL,
  SOUND_MASTER,
  SOUND_SOURCES,
  type SoundScene,
  type SoundSource,
  cueChip,
  masterFor,
  mixLevels,
  rememberLevel,
  rememberSound,
  soundCues,
  soundLevel,
  soundSetting,
  standingChips,
  trackStarts,
} from './sound.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const store = (seed?: string): Storage & { held: Map<string, string> } => {
  const held = new Map<string, string>()
  if (seed !== undefined) held.set('sj.sound', seed)
  return {
    held,
    getItem: (k) => held.get(k) ?? null,
    setItem: (k, v) => held.set(k, v),
    removeItem: (k) => {
      held.delete(k)
    },
    clear: () => {
      held.clear()
    },
    key: () => null,
    length: 0,
  }
}

const NIGHT = 0,
  NOON = 720

const scene = (over: Partial<SoundScene> = {}): SoundScene => ({
  weatherKind: 'sunny',
  minuteOfDay: NOON,
  firesInView: 0,
  firefliesInView: 0,
  voicesInView: 0,
  bellAgeMs: null,
  ...over,
})

const sources = (s: SoundScene): SoundSource[] => soundCues(s).map((c) => c.source)

describe('★ the town is muted until a viewer asks for it (task 18)', () => {
  it('★ a browser that has never been asked hears nothing', () => {
    expect(soundSetting(store())).toBe('muted')
    expect(soundSetting(null)).toBe('muted')
  })

  it('★ round-trips the choice through localStorage', () => {
    const s = store()
    rememberSound(s, 'on')
    expect(s.held.get('sj.sound')).toBe('on')
    expect(soundSetting(s)).toBe('on')
    rememberSound(s, 'muted')
    expect(soundSetting(s)).toBe('muted')
  })

  it('★ falls back to muted on a word this build does not know', () => {
    expect(soundSetting(store('roaring'))).toBe('muted')
  })

  it('★ takes a store that throws on every touch', () => {
    const angry = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }
    expect(soundSetting(angry)).toBe('muted')
    expect(() => {
      rememberSound(angry, 'on')
    }).not.toThrow()
  })

  it('★ reads and writes through the guarded helper, never `localStorage` itself', () => {
    expect(src('./sound.ts')).not.toMatch(/\blocalStorage\b/)
  })
})

describe('★ every sound has a source the viewer can see', () => {
  it('★ no fire heard where no fire is drawn', () => {
    expect(sources(scene({ minuteOfDay: NIGHT }))).not.toContain('fire')
    expect(sources(scene({ minuteOfDay: NIGHT, firesInView: 1 }))).toContain('fire')
  })

  it('★ no rain heard on a dry sky, and rain heard under one that is drawing drops', () => {
    expect(sources(scene())).not.toContain('rain')
    for (const k of ['rain', 'storm'])
      expect(sources(scene({ weatherKind: k })), k).toContain('rain')
    for (const k of ['cloudy', 'snow'])
      expect(sources(scene({ weatherKind: k })), k).not.toContain('rain')
  })

  // ★ The crickets and the fireflies are the same clear night: the swarm on the grass IS the
  // visible source, so a night with no firefly in the frame is a night with no crickets.
  it('★ crickets only where the fireflies are, and only on a clear night', () => {
    expect(sources(scene({ minuteOfDay: NIGHT, firefliesInView: 20 }))).toContain('crickets')
    expect(sources(scene({ minuteOfDay: NIGHT, firefliesInView: 0 }))).not.toContain('crickets')
    expect(sources(scene({ minuteOfDay: NOON, firefliesInView: 20 }))).not.toContain('crickets')
    expect(
      sources(scene({ minuteOfDay: NIGHT, weatherKind: 'rain', firefliesInView: 20 })),
    ).not.toContain('crickets')
  })

  it('★ a murmur only while a room the camera can see is talking', () => {
    expect(sources(scene())).not.toContain('murmur')
    expect(sources(scene({ voicesInView: 3 }))).toContain('murmur')
  })

  it('★ the bell rings for its own tail and then stops', () => {
    expect(sources(scene({ bellAgeMs: 0 }))).toContain('bell')
    expect(sources(scene({ bellAgeMs: BELL_MS - 1 }))).toContain('bell')
    expect(sources(scene({ bellAgeMs: BELL_MS }))).not.toContain('bell')
    expect(sources(scene({ bellAgeMs: null }))).not.toContain('bell')
  })

  // The whole picture drifts on `windNow()` — every canopy, every column of smoke — so the
  // wind is the one voice whose source is always on screen.
  it('the wind is always there, and leans on the weather', () => {
    expect(sources(scene())).toContain('wind')
    const gain = (k: string): number =>
      soundCues(scene({ weatherKind: k })).find((c) => c.source === 'wind')!.gain
    expect(gain('storm')).toBeGreaterThan(gain('cloudy'))
    expect(gain('cloudy')).toBeGreaterThan(gain('sunny'))
  })
})

describe('★ a cue chip appears with every sound that starts', () => {
  const worlds: SoundScene[] = [
    scene(),
    scene({ minuteOfDay: NIGHT, firefliesInView: 40, firesInView: 2, voicesInView: 4 }),
    scene({ weatherKind: 'storm', firesInView: 1, voicesInView: 2, bellAgeMs: 10 }),
    scene({ weatherKind: 'rain', minuteOfDay: NIGHT, firesInView: 5 }),
    scene({ weatherKind: 'snow', bellAgeMs: BELL_MS - 1 }),
  ]

  // ★ ONE LIST DRIVES BOTH. The chips are not a caption written beside the audio: they are the
  // cue list itself, so a sound the chips do not name cannot be played at all.
  it('★ every cue carries printable words, in every world', () => {
    for (const w of worlds)
      for (const cue of soundCues(w)) {
        expect(cue.text, cue.source).toBe(cueChip(cue.source))
        expect(cue.text.startsWith('♪ '), cue.source).toBe(true)
        expect(cue.text.length).toBeGreaterThan(2)
      }
  })

  it('★ names every source it can ever emit', () => {
    for (const s of SOUND_SOURCES) expect(CUE_WORD[s].length).toBeGreaterThan(0)
    const seen = new Set(worlds.flatMap((w) => sources(w)))
    for (const s of SOUND_SOURCES) expect(seen.has(s), s).toBe(true)
  })

  it('★ the engine is handed the same list the chips are drawn from', () => {
    expect(src('../stage/Soundscape.tsx')).toMatch(/synth\.current\?\.play\(cues\)/)
    expect(src('../stage/Soundscape.tsx')).toMatch(/standingChips\(/)
    expect(src('../stage/Soundscape.tsx')).toMatch(/trackStarts\(/)
  })

  // ★ EVERY START GETS ITS WORD, and a voice that is merely still running does not: the sun arc
  // is the one permanent mark over the town, so "♪ WIND" may not stand there all day.
  it('★ stamps a chip the instant a voice enters the mix', () => {
    const quiet = soundCues(scene())
    const stormy = soundCues(scene({ weatherKind: 'storm', firesInView: 1 }))
    let book = trackStarts([], quiet, 1000)
    expect(standingChips(book, 1000).map((c) => c.source)).toEqual(['wind'])
    book = trackStarts(book, stormy, 6000)
    // the wind was already running and its chip has expired; rain and fire have just begun
    expect(standingChips(book, 6000).map((c) => c.source)).toEqual(['rain', 'fire'])
    expect(book.find((c) => c.source === 'wind')!.sinceMs).toBe(1000)
  })

  it('★ retires a chip after its hold and forgets a voice that stops', () => {
    const cues = soundCues(scene({ firesInView: 1 }))
    const book = trackStarts([], cues, 0)
    expect(standingChips(book, CUE_CHIP_MS - 1)).toHaveLength(cues.length)
    expect(standingChips(book, CUE_CHIP_MS)).toEqual([])
    // gone and back is a new start, and a new chip
    const gone = trackStarts(book, soundCues(scene()), 9000)
    const back = trackStarts(gone, cues, 9000)
    expect(back.find((c) => c.source === 'fire')!.sinceMs).toBe(9000)
    expect(standingChips(back, 9000).map((c) => c.source)).toContain('fire')
  })
})

describe('★ nothing the mix can do reaches a clipping sum', () => {
  // ★ REWRITTEN. The old pin dropped the bell before it summed, so the one loudest event in the
  // town was the one thing the headroom claim never counted. It sums the whole mix now.
  it('★ the loudest world, bell included, stays under one with the master on it', () => {
    const loudest = scene({
      weatherKind: 'storm',
      minuteOfDay: NIGHT,
      firesInView: 99,
      firefliesInView: 99,
      voicesInView: 99,
      bellAgeMs: 0,
    })
    const sum = mixLevels(soundCues(loudest)).reduce((a, l) => a + l.gain, 0)
    expect(sum).toBeLessThanOrEqual(1)
    expect(sum * SOUND_MASTER).toBeLessThan(0.7)
    expect(SOUND_MASTER).toBeLessThanOrEqual(0.6)
  })

  it('every gain is positive and bounded, in every world', () => {
    for (let m = 0; m < 1440; m += 13)
      for (const k of ['sunny', 'cloudy', 'rain', 'storm', 'snow'])
        for (const cue of soundCues(scene({ minuteOfDay: m, weatherKind: k, firesInView: 3 }))) {
          expect(cue.gain, `${k} ${m} ${cue.source}`).toBeGreaterThan(0)
          expect(cue.gain).toBeLessThanOrEqual(1)
        }
  })

  it('is a stable order, so a chip that is still true never moves under the pointer', () => {
    const a = sources(scene({ weatherKind: 'storm', firesInView: 1, voicesInView: 1 }))
    const b = sources(
      scene({ weatherKind: 'storm', firesInView: 1, voicesInView: 1, bellAgeMs: 0 }),
    )
    expect(b.filter((s) => s !== 'bell')).toEqual(a)
  })
})

describe('★ the mix, and not a pile of gains', () => {
  const level = (cues: ReturnType<typeof soundCues>, source: SoundSource): number =>
    mixLevels(cues).find((l) => l.source === source)?.gain ?? 0

  // ★ 0.2 OF CRICKET WAS NOT 0.2 OF WIND. A tone in the ear's own octave was budgeted beside a
  // lowpassed noise as though a number meant one loudness at any pitch. It does now.
  it('★ weights every voice against the ear before it reaches the bus', () => {
    const night = soundCues(scene({ minuteOfDay: NIGHT, firefliesInView: 20 }))
    expect(level(night, 'crickets')).toBeLessThan(0.04)
    expect(level(night, 'crickets')).toBeLessThan(level(night, 'wind') / 2)
  })

  it('★ the weather gives way to whatever the frame is about', () => {
    const quiet = soundCues(scene({ weatherKind: 'rain' }))
    const talking = soundCues(scene({ weatherKind: 'rain', voicesInView: 3 }))
    const drop = level(talking, 'rain') / level(quiet, 'rain')
    expect(20 * Math.log10(drop)).toBeCloseTo(-DUCK_DB, 5)
    // the murmur itself keeps its gain, which is the whole point of ducking the rest
    expect(level(talking, 'murmur')).toBe(level(soundCues(scene({ voicesInView: 3 })), 'murmur'))
  })

  it('★ a placed voice carries its own side of the frame', () => {
    const left = mixLevels(soundCues(scene({ firesInView: 1, firePan: -0.8 })))
    expect(left.find((l) => l.source === 'fire')!.pan).toBe(-0.8)
    // the weather is everywhere, so it is nowhere in particular
    expect(left.find((l) => l.source === 'wind')!.pan).toBe(0)
  })

  it('★ a fire crossing the frame moves the gain rather than stepping it', () => {
    const near = soundCues(scene({ firesInView: 1 }))[1]!.gain
    const far = soundCues(scene({ firesInView: 0.12 }))[1]!.gain
    expect(far).toBeLessThan(near)
    expect(far).toBeGreaterThan(0)
  })

  // ★ THE SECOND BELL WAS SILENT. Two strikes printed the same cue list, so the synth saw no
  // change and never rang. The strike is a number now, and two of them differ.
  it('★ a second law inside the first bell tail is a new strike', () => {
    const first = soundCues(scene({ bellAgeMs: 0, bellStrike: 1 }))
    const second = soundCues(scene({ bellAgeMs: 0, bellStrike: 2 }))
    const of = (c: ReturnType<typeof soundCues>): number =>
      c.find((x) => x.source === 'bell')!.strike
    expect(of(first)).not.toBe(of(second))
  })

  it('the wind answers the gust the canopies lean to', () => {
    const gain = (gust: number): number => soundCues(scene({ gust }))[0]!.gain
    expect(gain(1)).toBeGreaterThan(gain(0))
    expect(gain(0)).toBeGreaterThan(0)
  })
})

describe('★ how loud, not only whether', () => {
  it('★ a viewer who has never been asked gets the middle of the range', () => {
    expect(soundLevel(store())).toBe(DEFAULT_LEVEL)
    expect(soundLevel(null)).toBe(DEFAULT_LEVEL)
  })

  it('★ round-trips a number and refuses one it cannot use', () => {
    const s = store()
    rememberLevel(s, 0.25)
    expect(soundLevel(s)).toBe(0.25)
    for (const bad of ['', 'loud', '-1', '2', 'NaN']) {
      s.held.set('sj.sound.level', bad)
      expect(soundLevel(s), bad).toBe(DEFAULT_LEVEL)
    }
  })

  // ★ THE TAB LEFT OPEN OVERNIGHT is the case the sound is worst at, so the slider stops
  // meaning what it says once it is dark.
  it('★ holds the master down after dark whatever the slider says', () => {
    expect(masterFor(1, 720)).toBe(SOUND_MASTER)
    expect(masterFor(1, 0)).toBe(SOUND_MASTER * NIGHT_LEVEL)
    expect(masterFor(1, 1380)).toBe(SOUND_MASTER * NIGHT_LEVEL)
    expect(masterFor(0.2, 0)).toBe(SOUND_MASTER * 0.2)
    expect(masterFor(0, 720)).toBe(0)
  })
})

describe('★ synthesized, on a gesture, and never a file', () => {
  const code = src('./sound.ts')

  it('★ loads no audio file and reaches no CDN', () => {
    expect(code).not.toMatch(/\.mp3|\.ogg|\.wav|\.m4a/)
    expect(code).not.toMatch(/https?:\/\//)
    expect(code).not.toMatch(/\bfetch\(|new Audio\(|XMLHttpRequest/)
  })

  it('★ builds the graph once and only ramps gains afterwards', () => {
    const at = code.indexOf('play(cues)')
    expect(at).toBeGreaterThan(0)
    const body = code.slice(at)
    expect(body).not.toContain('createBufferSource')
    expect(body).not.toContain('createBiquadFilter')
    // ...the bell is the one exception, and it says so
    expect(body).toContain('ring(')
  })

  it('★ survives a runtime with no WebAudio at all rather than throwing on import', () => {
    expect(code).toMatch(/typeof AudioContext === 'undefined'/)
  })

  it('★ never opens a context before the viewer asks for sound', () => {
    expect(code).toMatch(/setMuted/)
    const build = code.indexOf('new AudioContext(')
    expect(build).toBeGreaterThan(code.indexOf('const wake ='))
  })

  // ★ THE STAGE NOBODY BUILT. Every voice used to be a gain straight onto one bus: no limiter,
  // no place, nothing to stop a storm and a bell landing on the same sample.
  it('★ puts a limiter and a place between the voices and the destination', () => {
    expect(code).toMatch(/createDynamicsCompressor/)
    expect(code).toMatch(/createStereoPanner/)
    expect(code).toMatch(/\.connect\(master\)\.connect\(ctx\.destination\)/)
  })

  // ★ THE MASTER OVER A STALE MIX is how a whole night's bed once landed at once at dawn: the
  // gains were written only when the printed cue list moved, and a still night never moves it.
  it('★ writes the cue list before it raises the master', () => {
    const body = code.slice(code.indexOf('const settle ='))
    expect(body.indexOf('write(mixLevels(held))')).toBeGreaterThan(-1)
    expect(body.indexOf('write(mixLevels(held))')).toBeLessThan(body.indexOf('writeMaster()'))
  })

  it('★ stops the clock for a tab nobody is looking at, and for a viewer who muted', () => {
    expect(code).toMatch(/suspend\(\)/)
    expect(code).toMatch(/setHidden/)
    const settle = code.slice(code.indexOf('const settle ='), code.indexOf('setMuted(next)'))
    expect(settle).toMatch(/suspend\(\)/)
    expect(code.slice(code.indexOf('setMuted(next)'))).toMatch(/settle\(\)/)
  })

  // ★ A 50% SQUARE AT 2.4 Hz IS A MACHINE, NOT AN INSECT, and the rate was picked off a rule
  // about flashing light. Chirps are scheduled on the audio clock now.
  it('★ chirps the cricket rather than gating a tone', () => {
    expect(code).not.toMatch(/'square'/)
    expect(code).toMatch(/linearRampToValueAtTime/)
    expect(code).toMatch(/CRICKET_HZ = 3\d{3}/)
  })
})

describe('★ the ♪ toggle', () => {
  const html = (setting: 'on' | 'muted'): string =>
    renderToStaticMarkup(createElement(SoundButton, { setting, onToggle: () => {} }))

  it('★ is a switch and opens nothing', () => {
    expect(html('on')).toContain('aria-pressed="true"')
    expect(html('muted')).toContain('aria-pressed="false"')
    for (const s of ['on', 'muted'] as const) {
      expect(html(s)).toContain('aria-label="Town sound"')
      expect(html(s)).not.toContain('aria-expanded')
    }
  })

  // ★ OFF IS A MARK, NOT A DARKER GROUND — the rule `.legend-chip.off` set and the wisp keeps.
  it('★ empties the note rather than swapping the paper', () => {
    const rects = (s: 'on' | 'muted'): number => html(s).match(/<rect/g)?.length ?? 0
    expect(rects('on')).toBeGreaterThan(rects('muted'))
  })

  it('★ stands in the corner cluster with the other two, off the signpost', () => {
    expect(src('../paper/Signpost.tsx')).not.toContain('sound')
    expect(src('./chrome.css')).toContain('.help-button, .thoughts-button, .sound-button {')
  })

  it('★ every token the cue chips name is a token the sheet declares', () => {
    const css = src('./chrome.css')
    const block = /\/\* ── the sound cues[\s\S]*?\n\n/.exec(css)?.[0] ?? ''
    expect(block).not.toBe('')
    for (const [, name] of block.matchAll(/var\((--[\w-]+)\)/g))
      expect(css, name).toContain(`${name}:`)
  })

  it('★ the chips carry their own ground over the town, like every other mark', () => {
    const css = src('./chrome.css')
    const blocks = [...css.matchAll(/\.sound-cue \{([^}]*)\}/g)].map((m) => m[1]!)
    const chip = blocks.find((b) => b.includes('color:')) ?? ''
    expect(chip).toContain('text-shadow: var(--halo-deep)')
    expect(chip).toContain('pointer-events: none')
  })
})
