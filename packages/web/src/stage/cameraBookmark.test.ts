// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { WorldStore } from '../state/worldStore.js'
import { CameraBookmark } from './CameraBookmark.js'

describe('camera bookmark', () => {
  it('keeps a manual follow distinct from director shots and releases it with one click', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const release = vi.fn()
    const start = vi.fn()
    const store = {
      subscribe: () => () => {},
      getState: () => ({ agents: { amara: { name: 'Amara' }, kamal: { name: 'Kamal' } } }),
    } as unknown as WorldStore
    const draw = async (following: string | null, autoCut: boolean, replaying = false) => {
      await act(async () => {
        root.render(
          createElement(CameraBookmark, {
            store,
            following,
            autoCut,
            cast: ['kamal'],
            replaying,
            handbackAt: () => null,
            onRelease: release,
            onStart: start,
          }),
        )
      })
    }
    try {
      await draw('amara', true)
      expect(host.textContent).toContain('Following·AmaraStop')
      expect(host.textContent).not.toContain('Kamal')
      await act(async () => {
        host.querySelector('button')?.click()
      })
      expect(release).toHaveBeenCalledOnce()
      await draw(null, false)
      expect(host.textContent).toContain('Free cameraStart director')
      await act(async () => {
        host.querySelector('button')?.click()
      })
      expect(start).toHaveBeenCalledOnce()
      await draw(null, true)
      expect(host.textContent).toContain('Director·KamalPause')
      await draw(null, false, true)
      expect(host.textContent).toContain('Replay·KamalRelease')
    } finally {
      await act(async () => {
        root.unmount()
      })
    }
  })
})
