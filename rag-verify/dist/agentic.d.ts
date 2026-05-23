import { MisinformationDetector, NewsArticle } from './detector';
interface AgenticVerificationResult {
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
declare class AgenticRAGVerifier {
    private detector;
    private llm;
    private onUpdate?;
    private toolContext;
    constructor(detector: MisinformationDetector, onUpdate?: UpdateCallback);
    private step;
    private createAnalyzeClaimTool;
    private createGenerateQueriesTool;
    private createFetchNewsTool;
    private createRetrieveEvidenceTool;
    private createFactCheckTool;
    private invokeLLMWithTools;
    private runClaimAnalystAgent;
    private runEvidenceResearcherAgent;
    private runFactCheckerAgent;
    private synthesizeResults;
    private safeField;
    private mapEvidence;
    verifyClaimAgentic(claim: string): Promise<AgenticVerificationResult>;
}
export { AgenticRAGVerifier, AgenticVerificationResult };
//# sourceMappingURL=agentic.d.ts.map