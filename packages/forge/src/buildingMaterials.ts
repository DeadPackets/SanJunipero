import { encodePng, type RawImage } from './post/raw.js'

export function buildingMaterialPrompt(kind: string, slot: 'wood' | 'roof'): string {
  const surface =
    slot === 'wood'
      ? 'Exterior wall material, warm cream plaster or honey timber, with fine horizontal grain.'
      : 'Roof surface, muted warm-grey slate or weathered clay, small regular overlapping tiles.'
  return `${surface} Appropriate to a ${kind.replace(/_/g, ' ')} in a quiet rural town. A flat seamless square of the surface alone, viewed straight on. No building silhouette, doors, windows, sky, lettering, light sources or cast shadows. Even neutral illumination, restrained contrast, warm painted pixel-art detail.`
}

export async function buildingSurfaceMaps(image: RawImage) {
  const { width, height, data } = image
  const normal = new Uint8ClampedArray(data.length)
  const roughness = new Uint8ClampedArray(data.length)
  const luminance = (x: number, y: number): number => {
    const i = (((y + height) % height) * width + ((x + width) % width)) * 4
    return (data[i]! * 0.2126 + data[i + 1]! * 0.7152 + data[i + 2]! * 0.0722) / 255
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const dx = (luminance(x - 1, y) - luminance(x + 1, y)) * 0.35
      const dy = (luminance(x, y + 1) - luminance(x, y - 1)) * 0.35
      const length = Math.hypot(dx, dy, 1)
      normal.set(
        [
          Math.round(127.5 + (dx / length) * 127.5),
          Math.round(127.5 + (dy / length) * 127.5),
          Math.round(127.5 + 127.5 / length),
          255,
        ],
        i,
      )
      const value = Math.round(205 + luminance(x, y) * 25)
      roughness.set([value, value, value, 255], i)
      data[i + 3] = 255
    }
  return {
    baseColor: await encodePng(image),
    normal: await encodePng({ width, height, data: normal }),
    roughness: await encodePng({ width, height, data: roughness }),
  }
}
