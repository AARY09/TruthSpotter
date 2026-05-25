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

function isRetryableEmbedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const status = (error as { httpResponse?: { status?: number } })?.httpResponse?.status;
  return status === 504 || status === 503 || status === 429 || /timeout|rate|503|504/i.test(msg);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  requireHuggingfaceApiKey();
  const input = text.trim().slice(0, 2000);
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await hf.featureExtraction({
        model: HF_EMBED_MODEL,
        inputs: input,
      });
      return toFlatVector(result);
    } catch (error) {
      if (attempt >= maxAttempts - 1 || !isRetryableEmbedError(error)) throw error;
      await sleep(600 * (attempt + 1));
    }
  }

  throw new Error('Embedding failed after retries');
}

/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
export class HuggingFaceEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < documents.length; i++) {
      results.push(await generateEmbedding(documents[i]));
      if (i < documents.length - 1) await sleep(350);
    }
    return results;
  }

  async embedQuery(document: string): Promise<number[]> {
    return generateEmbedding(document);
  }
}
