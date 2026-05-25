import { Document } from '@langchain/core/documents';
export interface NewsArticlePayload {
    title: string;
    snippet: string;
    link: string;
    date: string;
    source?: string;
}
export interface EvidenceQueryContext {
    claim: string;
    extractedClaims: string[];
    keywords: string[];
    context: string;
    searchQueries?: string[];
}
export interface RankedEvidence {
    doc: Document;
    semanticScore: number;
    combinedScore: number;
}
/** Max articles to fetch + embed per verification (override via MAX_ARTICLES env) */
export declare const MAX_ARTICLES_TO_INDEX: number;
/** Per Google News query — keeps 3 queries under the global cap */
export declare const MAX_ARTICLES_PER_NEWS_QUERY: number;
/** SerpAPI often returns source as an object ({ name, icon }) instead of a string */
export declare function toTextField(value: unknown): string;
export declare function sanitizeNewsArticle(raw: Record<string, unknown>): NewsArticlePayload;
export declare function formatArticleForEmbedding(article: NewsArticlePayload): string;
export declare function articlesToDocuments(articles: NewsArticlePayload[]): Document[];
export declare function extractKeywordTokens(claim: string, extra?: string[]): string[];
export declare function computeKeywordCoverage(keywords: string[], text: string): number;
export declare function computeRecencyWeight(dateStr: string | undefined): number;
export declare function normalizeLink(url: string | undefined): string | null;
export declare function dedupeDocumentsByLink(docs: Document[]): Document[];
export declare function buildRetrievalQueries(claim: string, analysis: EvidenceQueryContext): string[];
export declare function rankEvidenceCandidates(candidates: Array<{
    doc: Document;
    semanticScore: number;
}>, keywords: string[], options?: {
    minCombinedScore?: number;
    limit?: number;
}): Document[];
//# sourceMappingURL=evidence-retrieval.d.ts.map