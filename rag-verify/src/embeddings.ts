import { HfInference } from '@huggingface/inference';
import { Embeddings } from '@langchain/core/embeddings';

export const HF_EMBED_MODEL =
  process.env.HF_EMBED_MODEL ?? 'BAAI/bge-small-en-v1.5';

/** bge-small-en-v1.5 and all-MiniLM-L6-v2 use 384 dimensions */
export const HF_EMBEDDING_DIMENSION = 384;

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

export function requireHuggingfaceApiKey(): string {
  const key = process.env.HUGGINGFACE_API_KEY;
  if (!key) {
    throw new Error('HUGGINGFACE_API_KEY is required');
  }
  return key;
}

function toFlatVector(result: (number | number[] | number[][])[]): number[] {
  if (result.length === 0) {
    throw new Error('Empty embedding response from Hugging Face');
  }

  if (typeof result[0] === 'number') {
    return result as number[];
  }

  const rows = result as number[][];
  if (rows.length === 1) {
    return rows[0];
  }

  const dim = rows[0].length;
  return rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  requireHuggingfaceApiKey();
  const result = await hf.featureExtraction({
    model: HF_EMBED_MODEL,
    inputs: text,
  });
  return toFlatVector(result);
}

/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
export class HuggingFaceEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = 3;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const vectors = await Promise.all(batch.map((doc) => generateEmbedding(doc)));
      results.push(...vectors);
      if (i + batchSize < documents.length) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return results;
  }

  async embedQuery(document: string): Promise<number[]> {
    return generateEmbedding(document);
  }
}
