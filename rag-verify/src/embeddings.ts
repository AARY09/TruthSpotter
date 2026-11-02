import { Embeddings } from '@langchain/core/embeddings';
import { recordHuggingFaceUsage } from './token-monitor';

export const HF_EMBED_MODEL =
  process.env.HF_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';

/** all-MiniLM-L6-v2 and bge-small-en-v1.5 use 384 dimensions */
export const HF_EMBEDDING_DIMENSION = 384;

export function requireHuggingfaceApiKey(): string {
  return process.env.HUGGINGFACE_API_KEY || 'local';
}

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', HF_EMBED_MODEL);
    })();
  }
  return extractorPromise;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.trim().slice(0, 2000);
  const extractor = await getExtractor();
  const output = await extractor(input, { pooling: 'mean', normalize: true });
  recordHuggingFaceUsage({ operation: 'featureExtraction', text: input });
  return Array.from(output.data);
}

/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
export class HuggingFaceEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const doc of documents) {
      results.push(await generateEmbedding(doc));
    }
    return results;
  }

  async embedQuery(document: string): Promise<number[]> {
    return generateEmbedding(document);
  }
}
