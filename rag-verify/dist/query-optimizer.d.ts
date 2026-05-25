export declare const MAX_QUERY_WORDS = 15;
export interface OptimizedSearchPlan {
    primaryQuery: string;
    secondaryQueries: string[];
    allQueries: string[];
    /** Tokens from the original claim only — used for relevance ranking */
    claimKeywords: string[];
}
export declare function enforceQueryWordLimit(query: string, maxWords?: number): string;
/**
 * Rewrite ambiguous claims into concise Google News queries via Groq.
 * Does not invent entities — prompt enforces claim-only grounding.
 */
export declare function optimizeSearchQueries(claim: string): Promise<OptimizedSearchPlan>;
//# sourceMappingURL=query-optimizer.d.ts.map