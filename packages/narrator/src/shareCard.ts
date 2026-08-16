const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const HEAT_BAR_MAX = 600

// Self-contained OG share card (1080x565, no external assets) — C8 rasterizes it.
export function renderShareCard(input: {
  day: number
  title: string
  subtitle: string
  heat: number
}): string {
  const ratio = Math.min(1, Math.max(0, input.heat / 10))
  const bar = Math.round(ratio * HEAT_BAR_MAX)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="565" viewBox="0 0 1080 565">` +
    `<rect width="1080" height="565" fill="#f6e7d7"/>` +
    `<rect x="0" y="0" width="1080" height="8" fill="#d97742"/>` +
    `<text x="72" y="110" font-family="Georgia, serif" font-size="34" fill="#8a6a4f">San Junipero</text>` +
    `<text x="72" y="170" font-family="Georgia, serif" font-size="28" fill="#a5836a">Day ${input.day}</text>` +
    `<text x="72" y="270" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="#4a3222">${esc(input.title)}</text>` +
    `<text x="72" y="340" font-family="Georgia, serif" font-size="32" fill="#6b503a">${esc(input.subtitle)}</text>` +
    `<rect x="72" y="440" width="${HEAT_BAR_MAX}" height="24" rx="12" fill="#e9d4bd"/>` +
    `<rect x="72" y="440" width="${bar}" height="24" rx="12" fill="#d97742"/>` +
    `<text x="72" y="500" font-family="Georgia, serif" font-size="22" fill="#a5836a">the day's fever, marked in embers</text>` +
    `</svg>`
  )
}
