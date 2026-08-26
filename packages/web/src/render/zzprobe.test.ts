import { describe, it } from 'vitest'
import { INTERIOR_KINDS } from '@sj/shared'
import { roomBox, roomCropPx, roomOriginY, ROOM_ZOOM, WALL_H_PX } from './roomShell.js'
import { ROOM_TILES, interiorToScreen } from './interiorMap.js'
import { roomSizeOf } from './interiors.js'

describe('crop probe', () => {
  it('table', () => {
    const kinds = [...INTERIOR_KINDS].sort()
    for (const kind of kinds) {
      let room = ROOM_TILES as { w: number; h: number }
      try { room = roomSizeOf(kind as never) } catch { /* keep default */ }
      const box = roomBox(room, WALL_H_PX)
      console.log(
        kind.padEnd(12),
        `${room.w}x${room.h}`.padEnd(8),
        `box=${box.height}`.padEnd(10),
        `@678=${roomCropPx(678, room)}`.padEnd(10),
        `@900=${roomCropPx(900, room)}`.padEnd(10),
        `@812=${roomCropPx(812, room)}`,
      )
    }
    console.log('--- horizontal ---')
    for (const kind of kinds) {
      let room = ROOM_TILES as { w: number; h: number }
      try { room = roomSizeOf(kind as never) } catch { /* keep default */ }
      const west = interiorToScreen(0, room.h).sx
      const east = interiorToScreen(room.w, 0).sx
      const widthPx = east - west
      console.log(kind.padEnd(12), `w=${widthPx}`.padEnd(10),
        [1280, 1440, 1478, 1512, 1920].map((sw) => `@${sw}=${Math.max(0, widthPx - sw)}`).join(' '))
    }
    for (const kind of kinds) {
      let room = ROOM_TILES as { w: number; h: number }
      try { room = roomSizeOf(kind as never) } catch { /* keep default */ }
      const box = roomBox(room, WALL_H_PX)
      for (const h of [678, 900]) {
        const y = roomOriginY(h, 56, ROOM_ZOOM, room, WALL_H_PX)
        console.log(kind, `h=${h}`,
          `originY=${y.toFixed(1)}`,
          `top=${(y + box.top).toFixed(1)}`,
          `bottom=${(y + box.bottom).toFixed(1)}`,
          `lostBelow=${Math.max(0, y + box.bottom - h).toFixed(1)}`,
          `lostAbove=${Math.max(0, -(y + box.top)).toFixed(1)}`)
      }
    }
  })
})
