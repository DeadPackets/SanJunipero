import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

const MODEL = 'Xenova/bge-small-en-v1.5'
export const EMBEDDING_DIM = 384

export class Embedder {
  private constructor(private readonly extractor: FeatureExtractionPipeline) {}

  static async create(cacheDir = 'data/models'): Promise<Embedder> {
    env.cacheDir = cacheDir
    const extractor = await pipeline('feature-extraction', MODEL)
    return new Embedder(extractor)
  }

  async embed(text: string): Promise<Float32Array> {
    const out = await this.extractor(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(out.data as Float32Array)
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
