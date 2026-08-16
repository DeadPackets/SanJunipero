import { describe, expect, it } from 'vitest'
import { PAN_STEP_PX, cameraActionFor, stepZoom } from './cameraNav.js'

describe('cameraActionFor', () => {
  it('maps arrows to pans of one step', () => {
    expect(cameraActionFor('ArrowLeft')).toEqual({ kind: 'pan', dx: PAN_STEP_PX, dy: 0 })
    expect(cameraActionFor('ArrowRight')).toEqual({ kind: 'pan', dx: -PAN_STEP_PX, dy: 0 })
    expect(cameraActionFor('ArrowUp')).toEqual({ kind: 'pan', dx: 0, dy: PAN_STEP_PX })
    expect(cameraActionFor('ArrowDown')).toEqual({ kind: 'pan', dx: 0, dy: -PAN_STEP_PX })
  })
  it('maps plus/minus (and their shifted forms) to zoom steps', () => {
    expect(cameraActionFor('+')).toEqual({ kind: 'zoom', dir: 1 })
    expect(cameraActionFor('=')).toEqual({ kind: 'zoom', dir: 1 })
    expect(cameraActionFor('-')).toEqual({ kind: 'zoom', dir: -1 })
    expect(cameraActionFor('_')).toEqual({ kind: 'zoom', dir: -1 })
  })
  it('maps Home to center and ignores everything else', () => {
    expect(cameraActionFor('Home')).toEqual({ kind: 'center' })
    expect(cameraActionFor('a')).toBeNull()
    expect(cameraActionFor('Enter')).toBeNull()
    expect(cameraActionFor('f')).toBeNull() // reserved for the fps overlay
  })
})

describe('stepZoom', () => {
  it('steps within 1-4 and clamps at the bounds', () => {
    expect(stepZoom(1, 1)).toBe(2)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(1, -1)).toBe(1)
    expect(stepZoom(3, -1)).toBe(2)
  })
  it('rounds a fractional current zoom before stepping', () => {
    expect(stepZoom(2.4, 1)).toBe(3)
  })
})
