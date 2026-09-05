import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SoundButton } from '../stage/SoundButton.js'
import {
  BELL_MS,
  CUE_CHIP_MS,
  CUE_WORD,
  SOUND_MASTER,
  SOUND_SOURCES,
  type SoundScene,
  type SoundSource,
  cueChip,
  rememberSound,
  soundCues,
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
  it('★ the loudest world stays under one, master included', () => {
    const loudest = scene({
      weatherKind: 'storm',
      minuteOfDay: NIGHT,
      firesInView: 99,
      firefliesInView: 99,
      voicesInView: 99,
      bellAgeMs: 0,
    })
    const held = soundCues(loudest).filter((c) => c.source !== 'bell')
    const sum = held.reduce((a, c) => a + c.gain, 0)
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
