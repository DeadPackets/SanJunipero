import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Container } from 'pixi.js'

// Only the book is stood in for. Everything else the layer reads off `textures.ts` is the real
// thing, so the rank under test is the one the module itself publishes.
const asks: { url: string; priority: number | undefined }[] = []
vi.mock('./textures.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./textures.js')>()
  return {
    ...real,
    TextureBook: class {
      peek(): null {
        return null
      }
      get(url: string, priority?: number): Promise<never> {
        asks.push({ url, priority })
        return Promise.reject(new Error('held'))
      }
      swap(): Promise<never> {
        return Promise.reject(new Error('held'))
      }
    },
  }
})

const { createBubbleLayer } = await import('./bubbles.js')
const { LOAD_PRIORITY } = await import('./textures.js')
import type { Scene } from './scene.js'
import type { WorldStore } from '../state/worldStore.js'

// Pixi measures labels through `document.createElement('canvas')` and this file runs with no DOM.
function stubCanvas(): void {
  if (typeof globalThis.document !== 'undefined') return
  const ctx = {
    font: '',
    measureText: (t: string) => ({
      width: t.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: t.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    fillText: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    scale: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
  }
  const canvas = { width: 1, height: 1, getContext: () => ctx, style: {} }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas, body: { appendChild: () => {} } },
  })
  Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    configurable: true,
    value: class {
      letterSpacing = ''
    },
  })
}

describe('★ a bubble tint is a texture request like any other', () => {
  beforeAll(stubCanvas)

  // ★ Measured: the readback called `Assets.load` straight, so the sheet it wanted was outside
  // MAX_IN_FLIGHT and the queue could not hold it behind the ground.
  it('★ asks the book, at the rank of a thing the camera is not waiting on', () => {
    asks.length = 0
    const amara = { x: 4, y: 4, alive: true, name: 'Amara' }
    const scene = {
      layers: { bubbles: new Container() },
      textScale: 1,
      getZoom: () => 1,
      wantsMotion: () => false,
      viewRect: () => ({ x: -1e4, y: -1e4, w: 2e4, h: 2e4 }),
      anchorOf: () => null,
      tags: { occupied: () => [], setOccupied: () => {} },
      ring: { bounds: () => null },
    } as unknown as Scene
    const store = {
      getState: () => ({ agents: { amara } }),
      sceneById: () => null,
      assetRecords: () => [],
    } as unknown as WorldStore

    createBubbleLayer(scene, store).spawnSpeech('amara', 'the iron is hot')

    expect(asks).toEqual([{ url: '/assets/character/amara.png', priority: LOAD_PRIORITY.far }])
  })
})
