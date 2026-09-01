import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

// ★ The director opened ON for everybody and re-armed twenty seconds after any input, so a
// person who came to look around had the camera taken off them, over and over.
describe('★ the director is for a broadcast, not for a person at a desk', () => {
  const APP = src('../App.tsx')

  it('★ is armed by the route, which is where the stream frame is decided', () => {
    expect(APP).toContain('useAutoCut(route.broadcast)')
  })

  it('keeps ONE hand on it: the D key', () => {
    expect(APP).toContain('onDirector: toggleDirector')
  })
})

// ★ The first cut of a round skipped the minimum, so arming the director yanked the camera the
// instant the heat landed — and toggling it off and on again did it every time.
describe('★ the first cut is a cut like any other', () => {
  const SRC = src('./DirectorMode.tsx')

  it('★ spends no bypass on it', () => {
    expect(SRC).not.toContain('const first =')
    expect(SRC).toContain('now - lastCutRef.current >= CUT_MIN_MS')
  })

  it('leaves the zoom to the camera, which already eases every stop it is given', () => {
    expect(SRC).toContain('scene.setZoom(DIRECTOR_ZOOM)')
    expect(src('../render/camera.ts')).toContain('easeOutCubic(t)')
  })
})
