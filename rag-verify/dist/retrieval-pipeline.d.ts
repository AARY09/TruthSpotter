import { Document } from '@langchain/core/documents';
import type { QdrantVectorStore } from '@langchain/qdrant';
import type { NewsArticlePayload } from './evidence-retrieval';
import type { OptimizedSearchPlan } from './query-optimizer';
export interface ClaimAnalysisContext {
    claim: string;
    extractedClaims: string[];
    keywords: string[];
    context: string;
    searchQueries: string[];
    searchPlan: OptimizedSearchPlan;
}
export interface FetchNewsFn {
    (query: string): Promise<NewsArticlePayload[]>;
}
export interface StoreArticlesFn {
    (articles: NewsArticlePayload[]): Promise<void | boolean>;
}
/** Fetch news for optimized queries only; cap total articles */
export declare function fetchNewsForPlan(plan: OptimizedSearchPlan, fetchNews: FetchNewsFn): Promise<NewsArticlePayload[]>;
/** Index articles with soft failure — verification can continue without Qdrant */
export declare function indexArticlesSafe(articles: NewsArticlePayload[], storeArticles: StoreArticlesFn): Promise<boolean>;
/** Minimal vector retrieval — one primary query to limit HF embedding calls */
export declare function retrieveEvidence(plan: OptimizedSearchPlan, vectorStore: QdrantVectorStore | null, freshArticles: NewsArticlePayload[], limit?: number): Promise<Document[]>;
export declare function freshArticlesToDocuments(articles: NewsArticlePayload[]): Document[];
//# sourceMappingURL=retrieval-pipeline.d.ts.map