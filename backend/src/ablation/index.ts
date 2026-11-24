// Similarity ablation: regenerate an answer without one card and measure how far it moves (local embeddings).
export { ablationRoutes } from './routes.ts'
export { createAblationService } from './service.ts'
export { createTransformersEmbedder, embeddingCacheDir, type Embedder } from './embedding.ts'
export { cosine, scoreCard, type AblationLabel } from './score.ts'
