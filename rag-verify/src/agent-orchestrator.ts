import { MisinformationDetector, NewsArticle } from './detector';
import { Document } from '@langchain/core/documents';

// ==============================
// TYPES
// ==============================

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

// ==============================
// CONTEXT INTERFACE
// ==============================

export interface VerificationContext {
  userId?: string;
  userName?: string;
  conversationId?: string;
  requestId: string;
  timestamp: string;
}

// ==============================
// ORCHESTRATOR CLASS
// ==============================

export class AgentOrchestrator {
  private detector: MisinformationDetector;
  private onUpdate?: UpdateCallback;
  private context?: VerificationContext;
  private agentInsights: {
    claimAnalyst: string;
    evidenceResearcher: string;
    factChecker: string;
    synthesizer: string;
  } = {
    claimAnalyst: '',
    evidenceResearcher: '',
    factChecker: '',
    synthesizer: '',
  };
  private searchQueries: string[] = [];
  private evidenceDocs: Document[] = [];
  private isRunning: boolean = false;
  private timeoutMs: number = 120000; // 2 minutes timeout

  constructor(detector: MisinformationDetector, onUpdate?: UpdateCallback, context?: VerificationContext) {
    this.detector = detector;
    this.onUpdate = onUpdate;
    this.context = context;

    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required');
    }
  }

  private step(message: string) {
    console.log(message);
    this.onUpdate?.(message);
  }

  private normalizeUrl(url: string | undefined): string | null {
    if (!url || typeof url !== 'string') return null;
    
    try {
      // Normalize URL: remove trailing slashes, query params, fragments, and normalize
      const normalized = url.toLowerCase().trim();
      // Remove protocol and www for comparison
      const withoutProtocol = normalized.replace(/^https?:\/\//, '').replace(/^www\./, '');
      // Remove trailing slash
      const withoutTrailing = withoutProtocol.replace(/\/$/, '');
      // Remove query params and fragments
      const clean = withoutTrailing.split('?')[0].split('#')[0];
      return clean || null;
    } catch {
      return url.toLowerCase().trim();
    }
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private extractLink(doc: Document): string | undefined {
    const metadata = doc.metadata as any;
    // Check multiple possible fields for links
    return metadata?.link || metadata?.url || metadata?.href || undefined;
  }

  private isValidLink(link: string | undefined): boolean {
    if (!link || typeof link !== 'string') return false;
    const trimmed = link.trim();
    // Check if it's a valid URL format
    return trimmed.length > 0 && (trimmed.startsWith('http://') || trimmed.startsWith('https://'));
  }

  private getRecencyScore(value: any): number {
    if (!value) return 0;
    const strValue = typeof value === 'string' ? value : (() => {
      try {
        return String(value);
      } catch {
        return '';
      }
    })();
    const parsed = Date.parse(strValue);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private mapEvidenceToNewsArticles(docs: Document[]): NewsArticle[] {
    // First, deduplicate documents at the Document level based on metadata
    const docSeen = new Set<string>();
    const uniqueDocs: Document[] = [];

    for (const doc of docs) {
      const docLink = this.extractLink(doc);
      const docTitle = (doc.metadata as any)?.title ?? (doc.metadata as any)?.source ?? '';
      const docSource = (doc.metadata as any)?.source ?? 'Unknown';
      
      let docKey: string;
      const normalizedLink = this.normalizeUrl(docLink);
      if (normalizedLink) {
        docKey = normalizedLink;
      } else {
        const normalizedTitle = this.normalizeText(docTitle);
        const normalizedSource = this.normalizeText(docSource);
        docKey = `${normalizedTitle}|${normalizedSource}`;
      }

      if (!docSeen.has(docKey)) {
        docSeen.add(docKey);
        uniqueDocs.push(doc);
      }
    }

    uniqueDocs.sort(
      (a, b) =>
        this.getRecencyScore((b.metadata as any)?.date ?? (b.metadata as any)?.published_at) -
        this.getRecencyScore((a.metadata as any)?.date ?? (a.metadata as any)?.published_at)
    );

    // Map the deduplicated documents and extract links from multiple fields
    const mapped = uniqueDocs.map((doc) => {
      const link = this.extractLink(doc);
      return {
        title: (doc.metadata as any)?.title ?? (doc.metadata as any)?.source ?? 'Untitled source',
        snippet: (doc.pageContent || '').slice(0, 150) + '...',
        link: link,
        date: (doc.metadata as any)?.date ?? 'Unknown date',
        source: (doc.metadata as any)?.source ?? 'Unknown',
      };
    });

    // Deduplicate again at the NewsArticle level (double-check)
    const seen = new Set<string>();
    const unique: Array<Omit<NewsArticle, 'link'> & { link?: string }> = [];

    for (const article of mapped) {
      let key: string;
      
      // Use normalized link as primary key if available
      const normalizedLink = this.normalizeUrl(article.link);
      if (normalizedLink) {
        key = normalizedLink;
      } else {
        // Fallback to normalized title + source combination
        const normalizedTitle = this.normalizeText(article.title);
        const normalizedSource = this.normalizeText(article.source);
        key = `${normalizedTitle}|${normalizedSource}`;
      }

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(article);
      }
    }

    unique.sort((a, b) => this.getRecencyScore(b.date) - this.getRecencyScore(a.date));

    // Filter to only include sources with valid links
    const withLinks: NewsArticle[] = [];
    for (const article of unique) {
      if (this.isValidLink(article.link) && article.link) {
        withLinks.push({
          ...article,
          link: article.link
        } as NewsArticle);
      }
    }
    
    // Return up to 5 sources with valid links
    return withLinks.slice(0, 5);
  }

  private cleanup() {
    // Clear large objects to free memory
    this.evidenceDocs = [];
    this.searchQueries = [];
    this.isRunning = false;
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  async verifyClaimAgentic(claim: string, context?: VerificationContext): Promise<AgenticVerificationResult> {
    if (this.isRunning) {
      throw new Error('Verification already in progress');
    }

    // Use provided context or existing context
    if (context) {
      this.context = context;
    }

    this.isRunning = true;
    this.step(`🤖 Starting Agentic Verification`);
    if (this.context?.userName) {
      this.step(`👤 User: ${this.context.userName} (Request ID: ${this.context.requestId})`);
    }
    this.step(`📌 Claim: "${claim}"`);

    // Reset state
    this.agentInsights = {
      claimAnalyst: '',
      evidenceResearcher: '',
      factChecker: '',
      synthesizer: '',
    };
    this.searchQueries = [];
    this.evidenceDocs = [];

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Verification timeout')), this.timeoutMs);
    });

    try {
      // Step 0: Route the query
      const queryType = await this.routeQuery(claim);
      
      // Run with timeout based on query type
      let resultPromise: Promise<AgenticVerificationResult>;
      
      if (queryType === 'casual') {
        resultPromise = this.handleCasualQuery(claim);
      } else {
        resultPromise = this.runVerification(claim);
      }
      
      const result = await Promise.race([resultPromise, timeoutPromise]);
      
      return result;
    } catch (error: any) {
      this.step(`❌ Error in agentic verification: ${error?.message || 'Unknown error'}`);
      console.error('❌ Agentic verification error:', error);

      // Fallback result
      const mappedEvidence = this.mapEvidenceToNewsArticles(this.evidenceDocs);
      return {
        isVerified: false,
        confidence: 0,
        riskLevel: 'HIGH',
        factCheckSummary: 'Verification failed due to an error. Please try again.',
        analysis: `Error: ${error?.message || 'Unknown error occurred during verification'}`,
        evidence: mappedEvidence,
        agentInsights: this.agentInsights,
        searchQueries: this.searchQueries,
        evidenceSources: this.evidenceDocs.length,
      };
    } finally {
      this.cleanup();
    }
  }

  // Router step: Classify query and route accordingly
  private async routeQuery(query: string): Promise<'casual' | 'verification'> {
    this.step(`🔀 Routing query...`);
    
    try {
      // Use a simple LLM call to classify the query
      const classificationPrompt = `Classify the following user query as either "CASUAL" or "VERIFICATION_REQUIRED".

Query: "${query}"

Rules:
- CASUAL: Conversational questions, general knowledge, opinions, creative requests, or questions that don't require fact-checking
- VERIFICATION_REQUIRED: Claims, statements, or questions that assert factual information that needs verification

Respond with ONLY one word: either "CASUAL" or "VERIFICATION_REQUIRED"`;

      const classification = (
        await this.detector.generateCompletion(classificationPrompt, {
          maxOutputTokens: 10,
          temperature: 0.1,
        })
      )
        .trim()
        .toUpperCase();

      if (classification.includes('CASUAL')) {
        this.step(`✅ Query classified as CASUAL`);
        return 'casual';
      }
      if (classification.includes('VERIFICATION')) {
        this.step(`✅ Query classified as VERIFICATION_REQUIRED`);
        return 'verification';
      }
    } catch (error) {
      this.step(`⚠️ Classification failed, defaulting to VERIFICATION_REQUIRED`);
    }
    
    // Default to verification if classification fails
    return 'verification';
  }

  // Handle casual queries - use direct LLM call instead of full agents SDK to avoid memory issues
  private async handleCasualQuery(query: string): Promise<AgenticVerificationResult> {
    this.step(`💬 Handling casual query...`);
    
    try {
      // Use a simple, direct LLM call instead of the full agents SDK stack
      // This avoids memory issues and is more efficient for casual queries
      const casualPrompt = `You are a helpful, friendly AI assistant. Answer the following question in a clear, conversational, and helpful manner.

Question: "${query}"

Provide a helpful response. Be concise but informative.`;

      this.step(`🤖 Generating response...`);
      const casualResponse = (
        await this.detector.generateCompletion(casualPrompt, {
          maxOutputTokens: 500,
          temperature: 0.7,
        })
      ).trim();

      this.step(`✅ Casual query handled successfully`);

      // Return a result formatted for casual queries
      return {
        isVerified: true, // Casual queries don't need verification
        confidence: 100,
        riskLevel: 'LOW',
        factCheckSummary: casualResponse || 'I\'m here to help with your question!',
        analysis: 'This was a casual query handled by the conversational agent.',
        evidence: [],
        agentInsights: {
          claimAnalyst: 'N/A - Casual query',
          evidenceResearcher: 'N/A - Casual query',
          factChecker: 'N/A - Casual query',
          synthesizer: 'N/A - Casual query',
        },
        searchQueries: [],
        evidenceSources: 0,
      };
    } catch (error: any) {
      this.step(`❌ Error handling casual query: ${error?.message}`);
      // Fallback: return a simple response
      return {
        isVerified: true,
        confidence: 100,
        riskLevel: 'LOW',
        factCheckSummary: 'I apologize, but I encountered an error processing your casual query. Please try rephrasing your question.',
        analysis: `Error: ${error?.message || 'Unknown error'}`,
        evidence: [],
        agentInsights: {
          claimAnalyst: 'N/A - Casual query',
          evidenceResearcher: 'N/A - Casual query',
          factChecker: 'N/A - Casual query',
          synthesizer: 'N/A - Casual query',
        },
        searchQueries: [],
        evidenceSources: 0,
      };
    }
  }

  // In agent-orchestrator.ts - Add batching and memory management
  private async runVerification(claim: string): Promise<AgenticVerificationResult> {
    try {
      // Stage 1: Analyze claim with lighter model
      const analysis = await this.detector.analyzeClaim(claim);
      this.agentInsights.claimAnalyst = `Extracted ${analysis.extractedClaims.length} sub-claims`;
      this.step(`✅ Claim Analyst completed`);
      
      // Stage 2: Parallel search with limits (prevent sequential blocking)
      this.step(`📚 Stage 2 — Evidence Researcher running...`);
      const searchQueries = analysis.keywords.slice(0, 2); // Reduced from 3
      this.searchQueries = searchQueries;
      
      // Parallel fetch with Promise.all instead of sequential
      const articlePromises = searchQueries.map(query => 
        this.detector.fetchGoogleNewsSearch(query)
          .then(articles => articles.slice(0, 2)) // Limit per query
          .catch(() => []) // Graceful failure
      );
      
      const allArticlesArrays = await Promise.allSettled(articlePromises);
      const allArticles = allArticlesArrays
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value);
      allArticles.sort((a, b) => this.getRecencyScore(b.date) - this.getRecencyScore(a.date));
      
      // Batch store to reduce API calls
      if (allArticles.length > 0) {
        await this.detector.storeNewsArticles(allArticles.slice(0, 5));
      }
      this.step(`✅ Evidence Researcher completed`);
      
      // Stage 3: Retrieve relevant evidence (pull extra, then sort by recency)
      this.step(`🔎 Stage 3 — Finding relevant evidence...`);
      const evidenceDocsRaw = await this.detector.findRelevantEvidence(claim, 20);
      this.evidenceDocs = evidenceDocsRaw.sort(
        (a, b) =>
          this.getRecencyScore((b.metadata as any)?.date ?? (b.metadata as any)?.published_at) -
          this.getRecencyScore((a.metadata as any)?.date ?? (a.metadata as any)?.published_at)
      );
      this.step(`✅ Retrieved ${this.evidenceDocs.length} evidence documents (recency prioritized)`);
      
      // Stage 4: Fact checking
      this.step(`⚖️ Stage 4 — Fact Checker running...`);
      const verification = await this.detector.verifyClaimWithEvidence(
        claim,
        this.evidenceDocs,
        analysis
      );
      this.agentInsights.factChecker = `Verdict: ${verification.isVerified ? 'SUPPORTED' : 'REFUTED/INCONCLUSIVE'}`;
      this.step(`✅ Fact Checker completed`);
      
      // Build final result
      const mappedEvidence = this.mapEvidenceToNewsArticles(this.evidenceDocs);
      
      const finalResult: AgenticVerificationResult = {
        isVerified: verification.isVerified,
        confidence: verification.confidence,
        riskLevel: verification.riskLevel,
        factCheckSummary: verification.factCheckSummary,
        analysis: verification.analysis,
        evidence: mappedEvidence,
        agentInsights: this.agentInsights,
        searchQueries: this.searchQueries,
        evidenceSources: this.evidenceDocs.length,
      };
      
      this.step(`🎯 Verification complete`);
      return finalResult;
    } catch (error: any) {
      throw new Error(`Verification failed: ${error?.message || 'Unknown error'}`);
    }
  }
}
