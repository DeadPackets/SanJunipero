import { useEffect, useState } from 'react'
import { ZOOM_MAX, ZOOM_MIN, type Scene } from '../render/scene.js'
import { stepZoom } from '../render/cameraNav.js'
import type { ZoomStop } from '../render/camera.js'

/** "0.5×", "1×" — a stop, never a rounded animation frame. The camera reads back an eased
 *  scale mid-transit, and rounding that showed 1× at the 0.5 overview stop. */
export const zoomLabel = (stop: ZoomStop): string => `${stop}×`

export function CameraHud({ scene }: { scene: Scene | null }) {
  const [zoom, setZoom] = useState<ZoomStop>(1)

  useEffect(() => {
    if (scene === null) return
    setZoom(scene.getZoomStop())
    return scene.onCamera(() => setZoom(scene.getZoomStop()))
  }, [scene])

  if (scene === null) return null
  return (
    <div className="camera-hud" role="group" aria-label="Camera">
      <button
        className="cam-btn"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => scene.setZoom(stepZoom(scene.getZoomStop(), -1))}
      >−</button>
      <span className="cam-zoom" aria-live="polite">{zoomLabel(zoom)}</span>
      <button
        className="cam-btn"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => scene.setZoom(stepZoom(scene.getZoomStop(), 1))}
      >+</button>
      <button className="cam-btn center" onClick={() => scene.centerHome()}>Center</button>
    </div>
  )
}
