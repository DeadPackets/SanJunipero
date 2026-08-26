import { createHash } from 'node:crypto'
import { EMBEDDING_DIM } from '../memory/embedder.js'

export class FakeEmbedder {
  static create(): Promise<FakeEmbedder> {
    return Promise.resolve(new FakeEmbedder())
  }

  embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(EMBEDDING_DIM)
    let digest = createHash('sha256').update(text).digest()
    let i = 0
    while (i < EMBEDDING_DIM) {
      for (const byte of digest) {
        if (i >= EMBEDDING_DIM) break
        v[i] = byte / 127.5 - 1
        i += 1
      }
      digest = createHash('sha256').update(digest).digest()
    }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    for (let j = 0; j < v.length; j += 1) v[j]! /= norm
    return Promise.resolve(v)
  }
}
