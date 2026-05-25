export const GROQ_API_KEY = process.env.GROQ_API_KEY;

export const GROQ_CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile';

export function requireGroqApiKey(): string {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is required');
  }
  return GROQ_API_KEY;
}
