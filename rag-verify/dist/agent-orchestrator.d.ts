import { MisinformationDetector, NewsArticle } from './detector';
export interface AgenticVerificationResult {
    isVerified: boolean;
    confidence: number;
    evidence: NewsArticle[];
    analysis: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    factCheckSummary: string;
    agentInsights: {
        claimAnalyst: string;
        evidenceResearcher: string;
        factChecker: string;
        synthesizer: string;
    };
    searchQueries: string[];
    evidenceSources: number;
}
type UpdateCallback = (msg: string) => void;
export interface VerificationContext {
    userId?: string;
    userName?: string;
    conversationId?: string;
    requestId: string;
    timestamp: string;
}
export declare class AgentOrchestrator {
    private detector;
    private onUpdate?;
    private context?;
    private agentInsights;
    private searchQueries;
    private evidenceDocs;
    private isRunning;
    private timeoutMs;
    constructor(detector: MisinformationDetector, onUpdate?: UpdateCallback, context?: VerificationContext);
    private step;
    private normalizeUrl;
    private normalizeText;
    private extractLink;
    private isValidLink;
    private getRecencyScore;
    private mapEvidenceToNewsArticles;
    private cleanup;
    verifyClaimAgentic(claim: string, context?: VerificationContext): Promise<AgenticVerificationResult>;
    private routeQuery;
    private handleCasualQuery;
    private runVerification;
}
export {};
//# sourceMappingURL=agent-orchestrator.d.ts.map