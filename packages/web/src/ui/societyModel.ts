export type LinkKind = 'talk' | 'give' | 'teach' | 'attack'

export type SocietyResponse = {
  nodes: Array<{ id: string; name: string; alive: boolean }>
  links: Array<{ source: string; target: string; kind: LinkKind; weight: number }>
  institutions?: Array<{ name: string; members: string[] }> // arrives with C7 — zero web changes needed
}

export const LINK_COLORS: Record<LinkKind, string> = {
  talk: '#7FB0C9',
  give: '#93B573',
  teach: '#F2C879',
  attack: '#E8785A',
}
export const NODE_ALIVE = '#93B573'
export const NODE_DEAD = '#857D75'
export const HALO_COLOR = '#F4E289'

export type GraphNode = { id: string; name: string; size: number; color: string; halo: boolean }
export type GraphLink = { source: string; target: string; kind: LinkKind; color: string; width: number }

export function toGraphData(api: SocietyResponse): { nodes: GraphNode[]; links: GraphLink[] } {
  const degree = new Map<string, number>()
  for (const l of api.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }
  const haloed = new Set(api.institutions?.flatMap((i) => i.members) ?? [])
  return {
    nodes: api.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      size: 6 + 2 * (degree.get(n.id) ?? 0),
      color: n.alive ? NODE_ALIVE : NODE_DEAD,
      halo: haloed.has(n.id),
    })),
    links: api.links.map((l) => ({
      source: l.source,
      target: l.target,
      kind: l.kind,
      color: LINK_COLORS[l.kind],
      width: 1 + Math.log2(l.weight),
    })),
  }
}
