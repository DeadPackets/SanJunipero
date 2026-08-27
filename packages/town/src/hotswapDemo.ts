import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import type { AssetRecord } from '@sj/shared'
import { AssetCodex, encodePng, openForgeDb, paletteRgb, type RawImage, type Rgb } from '@sj/forge'
import { DEV_DB_PATH } from './devWorld.js'

export const HOUSE_PX = 64

// master-palette picks: cream wall, honey-wood gable, dark ink outline, honey door
const P = paletteRgb()
const CREAM: Rgb = P[1]! // #F6E8D5
const WOOD: Rgb = P[7]! // #C68A48
const WOOD_DARK: Rgb = P[8]! // #A66E38
const INK: Rgb = P[31]! // #241F2B
const DOOR: Rgb = P[9]! // #7E512B

function fillRect(
  img: RawImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  [r, g, b]: Rgb,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  }
}

// a deterministic timber house: honey gable roof over a cream body, ink base line, wood door
export function drawHouse(): RawImage {
  const img: RawImage = {
    width: HOUSE_PX,
    height: HOUSE_PX,
    data: new Uint8ClampedArray(HOUSE_PX * HOUSE_PX * 4),
  }
  fillRect(img, 0, 0, 64, 64, CREAM)
  // gable: rows 0..27 step inward one px per row from each side
  for (let y = 0; y < 28; y++)
    fillRect(img, Math.max(0, 27 - y), y, Math.min(64, 64 - 2 * Math.max(0, 27 - y)), 1, WOOD)
  fillRect(img, 0, 26, 64, 4, WOOD_DARK) // eaves band
  fillRect(img, 4, 30, 56, 30, CREAM) // wall face
  fillRect(img, 8, 34, 10, 10, WOOD_DARK) // window left
  fillRect(img, 46, 34, 10, 10, WOOD_DARK) // window right
  fillRect(img, 27, 38, 10, 22, DOOR) // door
  fillRect(img, 0, 60, 64, 4, INK) // ground shadow base
  return img
}

export async function registerDemoHouse(db: Database.Database): Promise<AssetRecord> {
  const codex = new AssetCodex(db)
  const png = await encodePng(drawHouse())
  return codex.register({
    class: 'building',
    desc: 'house: timber dwelling',
    kind: 'house',
    footprint: { w: 2, h: 2 },
    png,
    widthPx: HOUSE_PX,
    heightPx: HOUSE_PX,
    status: 'ready',
    score: 9,
    attempts: 1,
    costUsd: 0,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.argv[2] ?? DEV_DB_PATH // the dev world db carries the forge tables too
  const db = openForgeDb(dbPath)
  registerDemoHouse(db)
    .then((rec) => {
      console.log(
        `the house is raised: ${rec.id} (kind ${rec.kind}) → viewers swap on the next pump`,
      )
      db.close()
    })
    .catch((err: unknown) => {
      console.error(err)
      process.exitCode = 1
    })
}
