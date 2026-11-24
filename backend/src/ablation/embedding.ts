// Local sentence embeddings (Transformers.js, Xenova/all-MiniLM-L6-v2, ONNX). The model is loaded on first use,
// so starting the server and running the tests never downloads anything.
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** The part of an embedding model the ablation needs. Tests inject a deterministic fake. */
export type Embedder = {
  /** One unit-length vector per text, in the same order. */
  embed(texts: string[]): Promise<number[][]>
}

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

/** MiniLM reads about 256 word pieces; longer answers are embedded in chunks of this size and averaged. */
const CHUNK_CHARS = 1000

/** Splits at paragraph or sentence boundaries where possible. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let current = ''
  for (const part of text.split(/(?<=\n\n|[.!?]\s)/)) {
    if (current.length + part.length > size && current.trim() !== '') {
      chunks.push(current)
      current = ''
    }
    current += part
    while (current.length > size * 2) {
      chunks.push(current.slice(0, size))
      current = current.slice(size)
    }
  }
  if (current.trim() !== '') chunks.push(current)
  return chunks.length > 0 ? chunks : [text]
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return norm === 0 ? v : v.map((x) => x / norm)
}

/** Default cache folder: `EMBEDDING_CACHE_DIR`, else a `models` folder next to the database file. */
export function embeddingCacheDir(db?: DatabaseSync, env: Record<string, string | undefined> = process.env): string {
  if (env.EMBEDDING_CACHE_DIR) return env.EMBEDDING_CACHE_DIR
  const location = db?.location()
  return location ? join(dirname(location), 'models') : join(tmpdir(), 'promptsys-models')
}

/** The real embedder. Loads the model on the first call; a failed load is retried on the next call. */
export function createTransformersEmbedder(options: { cacheDir: string }): Embedder {
  type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>
  let extractor: Promise<Extractor> | undefined

  const load = (): Promise<Extractor> => {
    extractor ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = options.cacheDir
      return (await pipeline('feature-extraction', EMBEDDING_MODEL)) as unknown as Extractor
    })().catch((err) => {
      extractor = undefined
      throw err
    })
    return extractor
  }

  return {
    async embed(texts) {
      const run = await load()
      const chunks = texts.map((t) => chunkText(t))
      const flat = chunks.flat()
      const vectors = (await run(flat, { pooling: 'mean', normalize: true })).tolist()
      let offset = 0
      return chunks.map((parts) => {
        const own = vectors.slice(offset, offset + parts.length)
        offset += parts.length
        if (own.length === 1) return own[0]
        return normalize(own[0].map((_, i) => own.reduce((s, v) => s + v[i], 0) / own.length))
      })
    },
  }
}
