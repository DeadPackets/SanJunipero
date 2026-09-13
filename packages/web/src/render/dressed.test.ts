import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@sj/shared'

// The book is the only thing here that calls Pixi. A stand-in keeps the loads under the test's
// own hand, so a url can be held open for as long as the assertion needs it.
const loads = new Map<string, { resolve: (t: unknown) => void }>()
vi.mock('pixi.js', () => ({
  Assets: {
    add: vi.fn(),
    load: vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          loads.set(url, { resolve })
        }),
    ),
  },
}))

const rec = (id: string, klass: AssetRecord['class']): AssetRecord =>
  ({
    id,
    seq: 1,
    class: klass,
    kind: id,
    status: 'ready',
    widthPx: 64,
    heightPx: 64,
  }) as AssetRecord

const RECORDS = [rec('grass', 'terrain'), rec('house', 'building'), rec('body', 'rig-part')]
const GROUND = '/assets/grass.png'
const SHOT = '/assets/house.png'
const OFF = '/assets/body.png'

// Every test needs the module's own counters at zero, and they are module state by design:
// Pixi's alias table is one global table, so the book over it is one book.
const freshBook = async (): Promise<typeof import('./textures.js')> => {
  vi.resetModules()
  loads.clear()
  return await import('./textures.js')
}

const land = async (url: string): Promise<void> => {
  loads.get(url)!.resolve({ source: {} })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('★ dressed is the ground and the shot, not every last byte', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // ★ Measured on six cold loads: the card left 1.3 to 3.0 seconds before the first texture
  // landed, every run, because nothing the reveal waited on could finish inside the timer.
  it('★ leaves once the ground and what is in the shot are in hand', async () => {
    const m = await freshBook()
    m.openBoot(RECORDS)
    const book = new m.TextureBook()
    void book.get(GROUND, m.LOAD_PRIORITY.ground).catch(m.artOptional)
    void book.get(SHOT, m.LOAD_PRIORITY.near).catch(m.artOptional)
    void book.get(OFF, m.LOAD_PRIORITY.far).catch(m.artOptional)
    let dressed = false
    void m.whenDressed(60_000).then(() => {
      dressed = true
    })

    await land(GROUND)
    expect(dressed, 'the shot itself has not arrived').toBe(false)
    await land(SHOT)
    expect(dressed, 'the ground and the shot are in hand, and that is a town').toBe(true)
    expect(loads.has(OFF), 'what the camera cannot see is still on the wire').toBe(true)
  })

  // ★ The timeout is a budget for the LOADING. Measured from the React effect it was spent on
  // the bundle and the socket, and the card left before one byte of art could have landed.
  it('★ and its patience runs from the first ask, not from the frame it was asked on', async () => {
    const m = await freshBook()
    let dressed = false
    void m.whenDressed().then(() => {
      dressed = true
    })
    await vi.advanceTimersByTimeAsync(2500)
    expect(dressed, 'nothing has been asked for, so nothing is late').toBe(false)

    m.openBoot(RECORDS)
    const book = new m.TextureBook()
    void book.get(GROUND, m.LOAD_PRIORITY.ground).catch(m.artOptional)
    await vi.advanceTimersByTimeAsync(2500)
    expect(dressed, 'two and a half seconds of loading is inside the budget').toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(dressed, 'and past it the town is shown as it stands').toBe(true)
  })
})
