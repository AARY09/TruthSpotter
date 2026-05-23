export const GROQ_API_KEY = process.env.GROQ_API_KEY;

export const GROQ_CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile';

export const GROQ_EMBED_MODEL =
  process.env.GROQ_EMBED_MODEL ?? 'nomic-embed-text-v1.5';

export const GROQ_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';

/** nomic-embed-text-v1.5 on Groq uses 768 dimensions */
export const GROQ_EMBEDDING_DIMENSION = 768;

export function requireGroqApiKey(): string {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is required');
  }
  return GROQ_API_KEY;
}
