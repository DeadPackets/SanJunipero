import { OrthographicCamera, Vector3 } from 'three'
import { screenToTileF } from '../iso.js'

export const WORLD_PX = 16 * Math.SQRT2
export const CAMERA_ELEVATION = Math.PI / 6

export function syncCamera(
  camera: OrthographicCamera,
  width: number,
  height: number,
  x: number,
  y: number,
  zoom: number,
): Vector3 {
  const center = screenToTileF((width / 2 - x) / zoom, (height / 2 - y) / zoom)
  const factor = WORLD_PX * zoom
  camera.left = -width / 2 / factor
  camera.right = width / 2 / factor
  camera.top = height / 2 / factor
  camera.bottom = -height / 2 / factor
  const target = new Vector3(center.x, 0, center.y)
  camera.position.set(center.x + 120, 120 * Math.sqrt(2 / 3), center.y + 120)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return target
}
