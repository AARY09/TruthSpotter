import 'dotenv/config';
import { Document } from '@langchain/core/documents';
import { type OptimizedSearchPlan } from './query-optimizer';
interface NewsArticle {
    title: string;
    snippet: string;
    link: string;
    date: string;
    source?: string;
}
interface VerificationResult {
    isVerified: boolean;
    confidence: number;
    evidence: NewsArticle[];
    analysis: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    factCheckSummary: string;
}
interface ClaimAnalysis {
    claim: string;
    extractedClaims: string[];
    keywords: string[];
    context: string;
    searchQueries: string[];
    searchPlan: OptimizedSearchPlan;
}
declare class MisinformationDetector {
    private embeddings;
    private qdrantClient;
    private vectorStore;
    constructor();
    private getCollectionVectorSize;
    private ensureCollectionDimension;
    private getRecencyScore;
    static defaultCollectionName(): string;
    initializeVectorStore(collectionName?: string): Promise<void>;
    fetchGoogleNewsSearch(query: string): Promise<NewsArticle[]>;
    storeNewsArticles(articles: NewsArticle[]): Promise<void>;
    /** Non-blocking index — verification continues if HuggingFace times out */
    storeNewsArticlesSafe(articles: NewsArticle[]): Promise<boolean>;
    runJsonTask(prompt: string, config?: {
        maxOutputTokens?: number;
        temperature?: number;
    }): Promise<any>;
    /** Plain-text completion for routing / casual chat */
    generateCompletion(prompt: string, config?: {
        maxOutputTokens?: number;
        temperature?: number;
    }): Promise<string>;
    getEmbeddingDimension(): number;
    isVectorStoreInitialized(): boolean;
    extractJsonFromResponse(response: string): any;
    analyzeClaim(claim: string): Promise<ClaimAnalysis>;
    /** Groq-optimized search queries (≤15 words, no hallucinated entities) */
    generateSearchQueries(claim: string): Promise<string[]>;
    fetchAndStoreEvidence(analysis: ClaimAnalysis): Promise<NewsArticle[]>;
    findRelevantEvidence(claim: string, k?: number, analysis?: ClaimAnalysis, freshArticles?: NewsArticle[]): Promise<Document[]>;
    verifyClaimWithEvidence(claim: string, evidence: Document[], analysis: ClaimAnalysis): Promise<VerificationResult>;
    updateNewsDatabase(topics: string[]): Promise<void>;
    verifyClaim(claim: string): Promise<VerificationResult>;
}
export { MisinformationDetector, VerificationResult, NewsArticle, ClaimAnalysis };
export { optimizeSearchQueries } from './query-optimizer';
//# sourceMappingURL=detector.d.ts.map