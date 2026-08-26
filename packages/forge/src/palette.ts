export type Rgb = [number, number, number]

// 40-colour warm cozy pastel master palette. Ramps: cream stone ×5, honey wood ×5, sage green ×5,
// dusty rose ×4, water/sky ×5, warm grey ×5, shadow darks ×4, warm accents ×4, skin tones ×3.
export const MASTER_PALETTE = [
  '#FFF6E9', '#F6E8D5', '#E8D5BC', '#D4BC9E', '#B89D7E',
  '#F2C879', '#E0A95E', '#C68A48', '#A66E38', '#7E512B',
  '#DCE8C8', '#B9D19A', '#93B573', '#6F9455', '#4F7040',
  '#F2C6C2', '#E09E9B', '#C47876', '#9E5A5C',
  '#D6EAF2', '#A8CFE0', '#7FB0C9', '#5A8CAB', '#3E6786',
  '#E9E2DA', '#CFC6BC', '#ABA198', '#857D75', '#5D5751',
  '#43394A', '#322B38', '#241F2B', '#171420',
  '#F7A66B', '#E8785A', '#8A6FA8', '#F4E289',
  '#F5D3B3', '#D9A876', '#9C6B47',
] as const

export const OUTLINE_DARKEN = 0.55

export function paletteRgb(hexes: readonly string[] = MASTER_PALETTE): Rgb[] {
  return hexes.map(h => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ])
}
