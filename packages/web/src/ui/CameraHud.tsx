import { useEffect, useState } from 'react'
import { ZOOM_MAX, ZOOM_MIN, type Scene } from '../render/scene.js'
import { stepZoom } from '../render/cameraNav.js'

export function CameraHud({ scene }: { scene: Scene | null }) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (scene === null) return
    setZoom(Math.round(scene.getZoom()))
    return scene.onCamera(() => setZoom(Math.round(scene.getZoom())))
  }, [scene])

  if (scene === null) return null
  return (
    <div className="camera-hud" role="group" aria-label="Camera">
      <button
        className="cam-btn"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => scene.setZoom(stepZoom(scene.getZoom(), -1))}
      >−</button>
      <span className="cam-zoom" aria-live="polite">{zoom}×</span>
      <button
        className="cam-btn"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => scene.setZoom(stepZoom(scene.getZoom(), 1))}
      >+</button>
      <button className="cam-btn center" onClick={() => scene.centerHome()}>Center</button>
    </div>
  )
}
