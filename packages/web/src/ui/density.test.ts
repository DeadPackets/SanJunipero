// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraActionFor } from '../render/cameraNav.js'
import { KEY_MAP } from '../stage/KeyMap.js'
import { stageKeyFor } from '../stage/useStageKeys.js'
import {
  DENSITIES,
  DENSITY_IDLE_MS,
  demoted,
  densitySetting,
  nextDensity,
  promoted,
  rememberDensity,
  useDensity,
  type Density,
  type DensityControl,
} from './density.js'

describe('one key cycles the three', () => {
  it('goes stage, watch, deck, and round again', () => {
    expect(nextDensity('stage')).toBe('watch')
    expect(nextDensity('watch')).toBe('deck')
    expect(nextDensity('deck')).toBe('stage')
    expect(DENSITIES.map(nextDensity)).toHaveLength(3)
  })

  it('is `[`, and it is a key nothing else claims', () => {
    expect(stageKeyFor('[')).toBe('density')
    expect(cameraActionFor('[')).toBeNull()
    expect(KEY_MAP.some((r) => r.keys.length === 1 && r.keys[0] === '[')).toBe(true)
  })
})

describe('ninety seconds with no hand', () => {
  it('leaves the world alone, from watch and from deck alike', () => {
    for (const mode of ['watch', 'deck'] as const) {
      expect(demoted(DENSITY_IDLE_MS, 0, mode)).toBe('stage')
      expect(demoted(DENSITY_IDLE_MS + 60_000, 0, mode)).toBe('stage')
    }
  })

  it('holds the mode while a hand is on it', () => {
    expect(demoted(DENSITY_IDLE_MS - 1, 0, 'deck')).toBe('deck')
    expect(demoted(0, 0, 'watch')).toBe('watch')
  })

  it('has nothing to take from stage', () => {
    expect(demoted(DENSITY_IDLE_MS * 10, 0, 'stage')).toBe('stage')
  })

  it('gives back the last mode used on the next input, and only from stage', () => {
    expect(promoted('stage', 'deck')).toBe('deck')
    expect(promoted('stage', 'stage')).toBe('stage')
    expect(promoted('watch', 'deck')).toBe('watch')
  })
})

describe('how this browser likes the town shown', () => {
  const store = (said: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => said })

  it('opens a first visit on the world alone', () => {
    expect(densitySetting(store(null))).toBe('stage')
    expect(densitySetting(null)).toBe('stage')
  })

  it('opens a returning browser on what it asked for last', () => {
    expect(densitySetting(store('watch'))).toBe('watch')
    expect(densitySetting(store('deck'))).toBe('deck')
  })

  it('reads a word this build does not know as the world alone', () => {
    expect(densitySetting(store('cinema'))).toBe('stage')
  })

  it('survives a browser that refuses site data', () => {
    const blocked = {
      getItem: (): string => {
        throw new Error('SecurityError')
      },
      setItem: (): never => {
        throw new Error('SecurityError')
      },
    }
    expect(densitySetting(blocked)).toBe('stage')
    expect(() => {
      rememberDensity(blocked, 'deck')
    }).not.toThrow()
  })
})

describe('the hook, over a real clock', () => {
  const roots: { unmount: () => void }[] = []
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  async function mount(): Promise<() => DensityControl> {
    let seen: DensityControl | null = null
    const Probe = (): null => {
      seen = useDensity()
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => {
      root.render(createElement(Probe))
    })
    return () => seen as unknown as DensityControl
  }

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
    })
    document.body.replaceChildren()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('opens on what the browser remembers, stands down after ninety seconds, and comes back on a hand', async () => {
    localStorage.setItem('sj:density', 'deck')
    vi.useFakeTimers()
    const at = await mount()
    expect(at().mode).toBe('deck')

    await act(async () => {
      vi.advanceTimersByTime(DENSITY_IDLE_MS + 1000)
    })
    expect(at().mode).toBe('stage')

    await act(async () => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(at().mode).toBe('deck')
  })

  it('remembers the mode a hand asked for, so the next tab opens on it', async () => {
    vi.useFakeTimers()
    const at = await mount()
    expect(at().mode).toBe('stage')

    await act(async () => {
      at().cycle()
    })
    expect(at().mode).toBe('watch')
    expect(localStorage.getItem('sj:density')).toBe('watch')

    await act(async () => {
      at().show('deck' satisfies Density)
    })
    expect(at().mode).toBe('deck')
    expect(localStorage.getItem('sj:density')).toBe('deck')
  })
})
