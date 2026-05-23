import { ChatGroq } from '@langchain/groq';
import { HumanMessage } from '@langchain/core/messages';
import { GROQ_CHAT_MODEL, requireGroqApiKey } from './groq-config';

export function createChatGroq(
  overrides?: Partial<ConstructorParameters<typeof ChatGroq>[0]>
): ChatGroq {
  return new ChatGroq({
    apiKey: requireGroqApiKey(),
    model: GROQ_CHAT_MODEL,
    temperature: 0.1,
    maxRetries: 2,
    ...overrides,
  });
}

export async function groqComplete(
  prompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const llm = createChatGroq({
    temperature: options?.temperature ?? 0.1,
    maxTokens: options?.maxTokens,
  });

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const content = response.content;

  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part as { text?: string }).text ?? ''))
      .join('');
  }
  return String(content ?? '');
}

export async function groqCompleteWithRetry(
  prompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    retries?: number;
    requireJson?: boolean;
  }
): Promise<string> {
  const retries = options?.retries ?? 2;
  const requireJson = options?.requireJson ?? false;

  for (let i = 0; i <= retries; i++) {
    try {
      const text = await groqComplete(prompt, options);
      if (text && (!requireJson || text.includes('{'))) return text;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`⚠️ Groq retry ${i + 1}/${retries} failed: ${message}`);
    }
  }

  throw new Error('Groq model failed to return a valid response after retries.');
}
