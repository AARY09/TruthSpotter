import { MisinformationDetector, NewsArticle } from './detector';
import { AgenticVerificationResult } from './agent-orchestrator';
export interface RumorWatcherResult {
    article: NewsArticle;
    extractedClaims: string[];
    verifications: AgenticVerificationResult[];
    timestamp: string;
}
export interface WatcherStats {
    articlesProcessed: number;
    claimsExtracted: number;
    verificationsCompleted: number;
    startTime: string;
    endTime: string;
    durationMs: number;
}
export declare class RumorWatcher {
    private detector;
    private orchestrator;
    private processedUrls;
    private onUpdate?;
    constructor(detector: MisinformationDetector, onUpdate?: (message: string) => void);
    private log;
    /**
     * Fetches daily rumors and viral news from Google News
     * Uses various search queries to find potential misinformation
     */
    fetchDailyRumors(maxArticles?: number): Promise<NewsArticle[]>;
    /**
     * Extracts verifiable claims from news articles using AI
     */
    extractClaimsFromArticle(article: NewsArticle): Promise<string[]>;
    /**
     * Verifies a claim using the AgentOrchestrator
     */
    verifyClaim(claim: string): Promise<AgenticVerificationResult>;
    /**
     * Processes a single article: extracts claims and verifies them
     */
    processArticle(article: NewsArticle): Promise<RumorWatcherResult>;
    /**
     * Main method: fetches daily rumors, extracts claims, and verifies them
     */
    runDailyWatch(maxArticles?: number): Promise<{
        results: RumorWatcherResult[];
        stats: WatcherStats;
    }>;
    /**
     * Clears the cache of processed URLs (useful for testing or reset)
     */
    clearProcessedCache(): void;
    /**
     * Returns the number of articles already processed
     */
    getProcessedCount(): number;
}
//# sourceMappingURL=rumor-watcher.d.ts.map