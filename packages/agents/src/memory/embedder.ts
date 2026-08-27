import type { FeatureExtractionPipeline } from '@huggingface/transformers'

const MODEL = 'Xenova/bge-small-en-v1.5'

export class Embedder {
  private constructor(private readonly extractor: FeatureExtractionPipeline) {}

  // Imported here, not at module scope: onnxruntime is ~128 MB and only an embed needs it.
  static async create(cacheDir = 'data/models'): Promise<Embedder> {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir
    const extractor = await pipeline('feature-extraction', MODEL)
    return new Embedder(extractor)
  }

  async embed(text: string): Promise<Float32Array> {
    const out = await this.extractor(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(out.data as Float32Array)
  }
}
