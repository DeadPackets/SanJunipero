import { createHash } from 'node:crypto'

export type RngState = [number, number, number, number]

export class RngStream {
  private constructor(private s: RngState) {}

  static seed(seed: string, streamName: string): RngStream {
    const h = createHash('sha256').update(`${seed}:${streamName}`).digest()
    return new RngStream([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)])
  }
  static from(state: RngState): RngStream { return new RngStream([...state] as RngState) }

  // sfc32
  next(): number {
    let [a, b, c, d] = this.s
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    this.s = [a, b, c, d]
    return (t >>> 0) / 4294967296
  }
  int(maxExclusive: number): number { return Math.floor(this.next() * maxExclusive) }
  state(): RngState { return [...this.s] as RngState }
}

export class RngStreams {
  private streams = new Map<string, RngStream>()
  constructor(private seed: string) {}

  get(name: string): RngStream {
    let s = this.streams.get(name)
    if (!s) { s = RngStream.seed(this.seed, name); this.streams.set(name, s) }
    return s
  }
  snapshot(): { __seed: string } & Record<string, RngState> {
    return {
      ...Object.fromEntries([...this.streams].map(([k, v]) => [k, v.state()])),
      __seed: this.seed,
    } as { __seed: string } & Record<string, RngState>
  }
  static restore(snap: Record<string, RngState | string>): RngStreams {
    const seed = typeof snap.__seed === 'string' ? snap.__seed : ''
    const s = new RngStreams(seed)
    for (const [k, v] of Object.entries(snap)) {
      if (k === '__seed') continue
      s.streams.set(k, RngStream.from(v as RngState))
    }
    return s
  }
}
