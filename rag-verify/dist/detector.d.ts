import 'dotenv/config';
import { Document } from '@langchain/core/documents';
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
}
declare class MisinformationDetector {
    private embeddings;
    private qdrantClient;
    private vectorStore;
    private textSplitter;
    constructor();
    private getRecencyScore;
    initializeVectorStore(collectionName?: string): Promise<void>;
    fetchGoogleNewsSearch(query: string): Promise<NewsArticle[]>;
    storeNewsArticles(articles: NewsArticle[]): Promise<void>;
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
    findRelevantEvidence(claim: string, k?: number): Promise<Document[]>;
    verifyClaimWithEvidence(claim: string, evidence: Document[], analysis: ClaimAnalysis): Promise<VerificationResult>;
    updateNewsDatabase(topics: string[]): Promise<void>;
    verifyClaim(claim: string): Promise<VerificationResult>;
}
export { MisinformationDetector, VerificationResult, NewsArticle, ClaimAnalysis, };
//# sourceMappingURL=detector.d.ts.map