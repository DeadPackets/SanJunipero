import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector3 } from 'three'
import { tileToScreen } from '../iso.js'
import { syncCamera } from './projection.js'

describe('Three camera shares the existing viewer projection', () => {
  it('keeps ground, labels and picks aligned through pan, zoom and resize', () => {
    for (const [w, h, x, y, zoom] of [
      [1280, 720, 340, -250, 3],
      [1440, 900, -80, 50, 1],
      [390, 700, 200, -800, 4],
    ]) {
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
      syncCamera(camera, w!, h!, x!, y!, zoom!)
      for (const [tx, ty] of [
        [0, 0],
        [55.5, 24.5],
        [100, 120],
      ]) {
        const p = new Vector3(tx, 0, ty).project(camera)
        const iso = tileToScreen(tx!, ty!)
        expect(((p.x + 1) * w!) / 2).toBeCloseTo(iso.sx * zoom! + x!, 5)
        expect(((1 - p.y) * h!) / 2).toBeCloseTo(iso.sy * zoom! + y!, 5)
      }
    }
  })
})
