import { nearestStop, stepStop, type ZoomStop } from './camera.js'

export const PAN_STEP_PX = 48

export type CameraAction =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; dir: 1 | -1 }
  | { kind: 'center' }

// Keyboard camera: pans move the WORLD under a fixed viewport (arrow-left reveals
// terrain to the left by pushing the world right), matching drag-pan direction.
export function cameraActionFor(key: string): CameraAction | null {
  switch (key) {
    case 'ArrowLeft': return { kind: 'pan', dx: PAN_STEP_PX, dy: 0 }
    case 'ArrowRight': return { kind: 'pan', dx: -PAN_STEP_PX, dy: 0 }
    case 'ArrowUp': return { kind: 'pan', dx: 0, dy: PAN_STEP_PX }
    case 'ArrowDown': return { kind: 'pan', dx: 0, dy: -PAN_STEP_PX }
    case '+': case '=': return { kind: 'zoom', dir: 1 }
    case '-': case '_': return { kind: 'zoom', dir: -1 }
    case 'Home': return { kind: 'center' }
    default: return null
  }
}

/** One step along `ZOOM_STOPS` (task 75). The keyboard, the bar's buttons and the wheel all
 *  come through here, so `+` and one notch mean exactly the same thing. A camera caught
 *  mid-transit is snapped to the stop it is nearest before stepping. */
export function stepZoom(current: number, dir: 1 | -1): ZoomStop {
  return stepStop(nearestStop(current), dir)
}
