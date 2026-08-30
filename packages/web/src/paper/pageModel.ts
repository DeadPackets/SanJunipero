export const PAGE_TABS = {
  folk: ['People', 'Bonds', 'Families', 'Customs'],
  chronicle: ['Today', 'Firsts', 'Chapters', 'Moments', 'Days'],
  found: ['Things', 'Places'],
  laws: ['World', 'Admin'],
  person: ['Story', 'Bonds', 'Ledger'],
  building: ['Provenance', 'Inside'],
} as const

export type PageKey = keyof typeof PAGE_TABS

export const ARMS = ['folk', 'chronicle', 'found', 'laws'] as const
export type Arm = (typeof ARMS)[number]

export const PAGE_TITLE: Readonly<Record<PageKey, string>> = {
  folk: 'Folk',
  chronicle: 'Chronicle',
  found: 'Found',
  laws: 'Laws',
  person: 'Story',
  building: 'Place',
}

export const firstTab = (page: PageKey): string => PAGE_TABS[page][0]

export function hasTab(page: PageKey, tab: string): boolean {
  return (PAGE_TABS[page] as readonly string[]).includes(tab)
}

export function tabFromKey(page: PageKey, key: string, from: string): string | null {
  const tabs = PAGE_TABS[page] as readonly string[]
  const n = tabs.length
  const i = Math.max(0, tabs.indexOf(from))
  if (key === 'ArrowRight') return tabs[(i + 1) % n]!
  if (key === 'ArrowLeft') return tabs[(i - 1 + n) % n]!
  if (key === 'Home') return tabs[0]!
  if (key === 'End') return tabs[n - 1]!
  return null
}

export const GRIP_CLOSE_PX = 40
/** A fast 25px flick is a dismissal; waiting for 40px is not. */
export const GRIP_FLING_PX_MS = 0.5

export function gripDismiss(downPx: number, downPxMs: number): boolean {
  return downPx > GRIP_CLOSE_PX || (downPx > 0 && downPxMs > GRIP_FLING_PX_MS)
}
