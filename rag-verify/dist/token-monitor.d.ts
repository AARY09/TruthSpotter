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
/** ~4 chars per token — used when a provider does not return usage */
export declare function estimateTokensFromText(text: string): number;
export declare function startTokenSession(sessionId: string): void;
export declare function endTokenSession(sessionId: string): TokenUsageSnapshot;
export declare function getSessionSnapshot(sessionId?: string): TokenUsageSnapshot;
export declare function runWithTokenSession<T>(sessionId: string, fn: () => Promise<T>): Promise<{
    result: T;
    usage: TokenUsageSnapshot;
}>;
export declare function recordGroqUsage(args: {
    operation: string;
    promptTokens?: number;
    completionTokens?: number;
    promptText?: string;
    completionText?: string;
}): void;
export declare function recordHuggingFaceUsage(args: {
    operation: string;
    text?: string;
    estimatedTokens?: number;
}): void;
export declare function getLifetimeUsage(): TokenUsageSnapshot;
export declare function getRecentTokenEvents(limit?: number): TokenEvent[];
export declare function extractGroqTokenUsage(response: unknown): {
    promptTokens?: number;
    completionTokens?: number;
};
//# sourceMappingURL=token-monitor.d.ts.map