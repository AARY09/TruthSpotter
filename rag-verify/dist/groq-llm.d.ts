import { ChatGroq } from '@langchain/groq';
export declare function createChatGroq(overrides?: Partial<ConstructorParameters<typeof ChatGroq>[0]>): ChatGroq;
export declare function groqComplete(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
}): Promise<string>;
export declare function groqCompleteWithRetry(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    retries?: number;
    requireJson?: boolean;
}): Promise<string>;
//# sourceMappingURL=groq-llm.d.ts.map