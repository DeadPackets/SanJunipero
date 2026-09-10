import { describe, expect, it } from 'vitest'
import { IDLE_HANDBACK_MS } from '../ui/autoCut.js'
import { HANDBACK_CHIP_MS, chipLabel } from './CameraChip.js'

// ★ CAMERA ON AUTO stood over the town from the first frame to the last: the label was written
// once and, on auto, never written again. Auto is the town's own state, so the chip only ever
// names the abnormal one, and the handback that ends it.
describe('★ the camera chip names the abnormal state, then leaves the corner', () => {
  const T0 = 1_700_000_000_000

  it('★ says nothing at all over a town nobody has touched', () => {
    for (const ms of [0, 1_000, 60_000, 3_600_000])
      expect(chipLabel(true, null, null, T0 + ms), `${ms}ms into the visit`).toBeNull()
  })

  it('★ counts the camera back under a hand, names the handback once, then goes quiet', () => {
    const deadline = T0 + IDLE_HANDBACK_MS
    expect(chipLabel(false, deadline, null, T0)).toBe('Camera back in 20s')
    expect(chipLabel(false, deadline, null, T0 + 19_000)).toBe('Camera back in 1s')
    expect(chipLabel(true, null, deadline, deadline)).toBe('Camera on auto')
    expect(chipLabel(true, null, deadline, deadline + HANDBACK_CHIP_MS - 1)).toBe('Camera on auto')
    for (const ms of [HANDBACK_CHIP_MS, 60_000, 3_600_000])
      expect(chipLabel(true, null, deadline, deadline + ms), `${ms}ms after`).toBeNull()
  })
})
