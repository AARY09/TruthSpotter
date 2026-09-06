import { AsyncLocalStorage } from 'async_hooks';

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

export interface TokenUsageSnapshot {
  groq: ProviderUsage;
  huggingface: ProviderUsage;
  totalTokens: number;
  totalCalls: number;
}

export interface TokenEvent {
  at: string;
  provider: 'groq' | 'huggingface';
  operation: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface SessionState {
  groq: ProviderUsage;
  huggingface: ProviderUsage;
  events: TokenEvent[];
}

const emptyUsage = (): ProviderUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
});

function emptySession(): SessionState {
  return {
    groq: emptyUsage(),
    huggingface: emptyUsage(),
    events: [],
  };
}

function snapshotFrom(state: SessionState): TokenUsageSnapshot {
  return {
    groq: { ...state.groq },
    huggingface: { ...state.huggingface },
    totalTokens: state.groq.totalTokens + state.huggingface.totalTokens,
    totalCalls: state.groq.calls + state.huggingface.calls,
  };
}

const als = new AsyncLocalStorage<{ sessionId: string }>();
const sessions = new Map<string, SessionState>();
const lifetime = emptySession();
const recentEvents: TokenEvent[] = [];
const MAX_RECENT_EVENTS = 200;

/** ~4 chars per token — used when a provider does not return usage */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function addUsage(target: ProviderUsage, prompt: number, completion: number): void {
  target.promptTokens += prompt;
  target.completionTokens += completion;
  target.totalTokens += prompt + completion;
  target.calls += 1;
}

function pushEvent(event: TokenEvent): void {
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  const sessionId = als.getStore()?.sessionId;
  if (sessionId) {
    const session = sessions.get(sessionId);
    session?.events.push(event);
  }
}

export function startTokenSession(sessionId: string): void {
  sessions.set(sessionId, emptySession());
}

export function endTokenSession(sessionId: string): TokenUsageSnapshot {
  const state = sessions.get(sessionId) ?? emptySession();
  const snap = snapshotFrom(state);
  sessions.delete(sessionId);
  return snap;
}

export function getSessionSnapshot(sessionId?: string): TokenUsageSnapshot {
  const id = sessionId ?? als.getStore()?.sessionId;
  if (!id) return snapshotFrom(emptySession());
  return snapshotFrom(sessions.get(id) ?? emptySession());
}

export async function runWithTokenSession<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<{ result: T; usage: TokenUsageSnapshot }> {
  startTokenSession(sessionId);
  try {
    const result = await als.run({ sessionId }, fn);
    return { result, usage: getSessionSnapshot(sessionId) };
  } finally {
    endTokenSession(sessionId);
  }
}

export function recordGroqUsage(args: {
  operation: string;
  promptTokens?: number;
  completionTokens?: number;
  promptText?: string;
  completionText?: string;
}): void {
  const prompt =
    args.promptTokens ?? estimateTokensFromText(args.promptText ?? '');
  const completion =
    args.completionTokens ?? estimateTokensFromText(args.completionText ?? '');

  addUsage(lifetime.groq, prompt, completion);
  const sessionId = als.getStore()?.sessionId;
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) addUsage(session.groq, prompt, completion);
  }

  const event: TokenEvent = {
    at: new Date().toISOString(),
    provider: 'groq',
    operation: args.operation,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
  };
  pushEvent(event);
  console.log(
    `📊 Groq tokens [${args.operation}]: +${prompt + completion} (in ${prompt} / out ${completion})`
  );
}

export function recordHuggingFaceUsage(args: {
  operation: string;
  text?: string;
  estimatedTokens?: number;
}): void {
  const tokens = args.estimatedTokens ?? estimateTokensFromText(args.text ?? '');
  addUsage(lifetime.huggingface, tokens, 0);
  const sessionId = als.getStore()?.sessionId;
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) addUsage(session.huggingface, tokens, 0);
  }

  const event: TokenEvent = {
    at: new Date().toISOString(),
    provider: 'huggingface',
    operation: args.operation,
    promptTokens: tokens,
    completionTokens: 0,
    totalTokens: tokens,
  };
  pushEvent(event);
}

export function getLifetimeUsage(): TokenUsageSnapshot {
  return snapshotFrom(lifetime);
}

export function getRecentTokenEvents(limit: number = 50): TokenEvent[] {
  return recentEvents.slice(-limit);
}

export function extractGroqTokenUsage(response: unknown): {
  promptTokens?: number;
  completionTokens?: number;
} {
  const r = response as {
    usage_metadata?: { input_tokens?: number; output_tokens?: number };
    response_metadata?: {
      tokenUsage?: { promptTokens?: number; completionTokens?: number };
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
  };

  const fromUsageMeta = r?.usage_metadata;
  if (fromUsageMeta?.input_tokens != null || fromUsageMeta?.output_tokens != null) {
    return {
      promptTokens: fromUsageMeta.input_tokens ?? 0,
      completionTokens: fromUsageMeta.output_tokens ?? 0,
    };
  }

  const tokenUsage = r?.response_metadata?.tokenUsage;
  if (tokenUsage?.promptTokens != null || tokenUsage?.completionTokens != null) {
    return {
      promptTokens: tokenUsage.promptTokens ?? 0,
      completionTokens: tokenUsage.completionTokens ?? 0,
    };
  }

  const usage = r?.response_metadata?.usage;
  if (usage?.prompt_tokens != null || usage?.completion_tokens != null) {
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
    };
  }

  return {};
}
