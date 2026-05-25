import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Document } from '@langchain/core/documents';
import { MisinformationDetector, NewsArticle } from './detector';

// ==============================
// TYPES
// ==============================
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

interface ToolResult {
  success: boolean;
  data: any;
  message: string;
}

type UpdateCallback = (msg: string) => void;

interface EvidenceContext {
  searchQueries: string[];
  newsArticles: NewsArticle[];
  kbDocs: Document[];
  summary: string;
}

// ==============================
// AGENTIC RAG SYSTEM
// ==============================
class AgenticRAGVerifier {
  private detector: MisinformationDetector;
  private llm: ChatGoogleGenerativeAI;
  private onUpdate?: UpdateCallback;

  constructor(detector: MisinformationDetector, onUpdate?: UpdateCallback) {
    this.detector = detector;
    this.onUpdate = onUpdate;
    const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!googleApiKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is required');
    }
    this.llm = new ChatGoogleGenerativeAI({
      apiKey: googleApiKey,
      modelName: 'gemini-2.5-flash',
      temperature: 0.3,
      maxOutputTokens: 1500,
    });
  }

  private step(message: string) {
    console.log(message);
    this.onUpdate?.(message);
  }

  // ==============================
  // TOOL: ANALYZE CLAIM
  // ==============================
  private async toolAnalyzeClaim(claim: string): Promise<ToolResult> {
    try {
      this.step(`🔧 Analyzing claim structure...`);
      const analysis = await this.detector.analyzeClaim(claim);

      const enrichmentPrompt = `You are a claim-structuring expert. Using the claim and the tool output below, produce a JSON object with fields:
{
  "mainClaim": string,
  "subClaims": string[],
  "entities": string[],
  "locations": string[],
  "dates": string[],
  "numbers": string[],
  "riskIndicators": string[],
  "urgency": "LOW" | "MEDIUM" | "HIGH",
  "contextSummary": string,
  "recommendedSearches": string[] // exactly 3 concise topics or query patterns
}

Rules:
- Only include factual details explicitly present in the claim or tool analysis.
- If a field is unavailable, return an empty array or sensible fallback text.
- Respond with JSON ONLY.

Claim: "${claim}"

Tool Extraction:
${JSON.stringify(analysis, null, 2)}`;

      const enrichedResponse = await this.llm.invoke(enrichmentPrompt);
      const enrichedRaw =
        typeof enrichedResponse.content === 'string'
          ? enrichedResponse.content
          : JSON.stringify(enrichedResponse.content);

      const enriched =
        this.safeParseJson(enrichedRaw, {
          mainClaim: claim,
          subClaims: analysis.extractedClaims ?? [claim],
          entities: [],
          locations: [],
          dates: [],
          numbers: [],
          riskIndicators: [],
          urgency: 'MEDIUM',
          contextSummary: analysis.context ?? 'General verification context',
          recommendedSearches: analysis.keywords?.slice(0, 3) ?? [],
        }) ?? {};

      return {
        success: true,
        data: {
          ...analysis,
          structured: enriched,
        },
        message: `Extracted ${analysis.extractedClaims.length} sub-claims & ${analysis.keywords.length} keywords`,
      };
    } catch {
      return {
        success: false,
        data: { keywords: claim.split(' ').slice(0, 5) },
        message: 'Partial analysis fallback executed',
      };
    }
  }

  // ==============================
  // AGENT 1: CLAIM ANALYST
  // ==============================
  private async runClaimAnalyst(claim: string): Promise<string> {
    this.step(`🔍 Stage 1 — Claim Analyst running...`);
    try {
      const analysisResult = await this.toolAnalyzeClaim(claim);
      const enriched = (analysisResult.data as any)?.structured ?? {};

      const prompt = `You are a Claim Analyst Agent. Summarize the claim into a precise brief for downstream agents.

Claim: "${claim}"

Structured Analysis:
${JSON.stringify(enriched, null, 2)}

Return a structured markdown report with:
- **Main Claim** (1 sentence)
- **Sub-Claims** (bullet list referencing any dates/locations/numbers)
- **Critical Entities & Locations** (bullet list)
- **Time Sensitivity & Risk** (e.g., "Urgency: HIGH due to ...")
- **Verification Focus** (3 concise bullets explaining what evidence is required, referencing sub-claims)
- **Search Strategy** (use recommendedSearches plus 1 additional suggestion if needed)

Always mention the urgency level explicitly and highlight ambiguities that could cause misinformation.`;

      const response = await this.llm.invoke(prompt);
      const output = response.content as string;
      this.step(`✅ Claim Analyst completed`);
      return output;
    } catch {
      this.step(`⚠️ Claim Analyst fallback executed`);
      return `Fallback claim analysis for: "${claim}". Key terms: ${claim
        .split(' ')
        .slice(0, 8)
        .join(', ')}`;
    }
  }

  // ==============================
  // AGENT 2: EVIDENCE RESEARCHER
  // (fetch → store → retrieve RAG)
  // ==============================
  private async runEvidenceResearcher(
    claim: string,
    analystOutput: string
  ): Promise<EvidenceContext> {
    this.step(`📚 Stage 2 — Evidence Researcher running...`);

    try {
      const analysis = await this.detector.analyzeClaim(claim);
      const searchQueries = analysis.searchQueries;
      this.step(`📌 Optimized queries: ${searchQueries.join(' | ')}`);

      const newsArticles = await this.detector.fetchAndStoreEvidence(analysis);

      this.step(`🔎 Ranking evidence by relevance...`);
      const curatedKbDocs = await this.detector.findRelevantEvidence(
        claim,
        undefined,
        analysis,
        newsArticles
      );

      const curatedNewsArticles = newsArticles.slice(0, 6);

      const summary = `Evidence summary:
- Search Queries: ${searchQueries.join(', ')}
- News Articles curated: ${curatedNewsArticles.length}
- KB Docs (vector hits): ${curatedKbDocs.length}`;

      this.step(
        `📚 Evidence Researcher completed (Articles: ${curatedNewsArticles.length}, KB docs: ${curatedKbDocs.length})`
      );

      return {
        searchQueries,
        newsArticles: curatedNewsArticles,
        kbDocs: curatedKbDocs,
        summary,
      };
    } catch {
      this.step(`⚠️ Evidence Researcher fallback executed`);
      return {
        searchQueries: [],
        newsArticles: [],
        kbDocs: [],
        summary: `Evidence fallback summary for claim: "${claim}"`,
      };
    }
  }

  // ==============================
  // AGENT 3: FACT CHECKER
  // ==============================
  private async runFactChecker(
    claim: string,
    analystOutput: string,
    evidence: EvidenceContext
  ): Promise<string> {
    this.step(`⚖️ Stage 3 — Fact Checker running...`);
    try {
      // Build a compact textual evidence bundle from KB docs
      const kbSnippets = evidence.kbDocs.slice(0, 6).map((doc, idx) => {
        const src = (doc.metadata as any)?.source || (doc.metadata as any)?.link || 'unknown';
        const date = (doc.metadata as any)?.date || 'unknown date';
        const snippet = (doc.pageContent || '').slice(0, 260).replace(/\s+/g, ' ');
        return `[#${idx + 1}] Source: ${src} (${date})\n${snippet}...`;
      });

      const prompt = `You are a professional fact-checker.

TASK: Decide whether the claim is SUPPORTED, REFUTED, or INCONCLUSIVE based on the evidence.

Claim:
${claim}

Claim Analyst Notes:
${analystOutput}

Evidence Summary:
${evidence.summary}

Detailed Evidence Snippets:
${kbSnippets.join('\n\n')}

INSTRUCTIONS:
- Carefully weigh all evidence.
- ALWAYS prioritize the most recent credible sources; if older and newer evidence conflict, treat the newer sources as authoritative unless they are clearly unreliable.
- Every reasoning sentence must reference snippet indices AND include the snippet date (example: "[#2, 11 Nov 2025] indicates ...").
- VERDICT rules:
  • If most strong, recent sources clearly support the claim → VERDICT: SUPPORTED
  • If strong evidence clearly contradicts the claim → VERDICT: REFUTED
  • If evidence is mixed / weak / not directly about the claim → VERDICT: INCONCLUSIVE

Return your answer in this exact format:

VERDICT: SUPPORTED | REFUTED | INCONCLUSIVE
REASONING: <2–4 sentences explaining why, referencing snippet indices like [#1], [#2], etc.>`;

      const response = await this.llm.invoke(prompt);
      this.step(`✅ Fact Checker completed`);
      return response.content as string;
    } catch {
      this.step(`⚠️ Fact Checker fallback executed`);
      return `VERDICT: INCONCLUSIVE
REASONING: Fact-checker fallback: unable to fully verify. Treat the claim as unconfirmed and require more evidence.`;
    }
  }

  // ==============================
  // SAFE STRING HELPERS
  // ==============================
  private safeField(v: any): string {
    if (typeof v === 'string') return v;
    if (!v) return 'Unknown';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v).slice(0, 120);
      } catch {
        return '[object]';
      }
    }
    return String(v);
  }

  private safeParseJson<T>(raw: string, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      try {
        const extractor = (this.detector as any)?.extractJsonFromResponse;
        if (extractor) {
          return extractor(raw) as T;
        }
      } catch {
        // ignore
      }
    }
    return fallback;
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

  private computeRecencyWeight(dateString?: string): number {
    const timestamp = this.getRecencyScore(dateString);
    if (!timestamp) return 0.3;
    const daysOld = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    if (daysOld <= 1) return 1;
    if (daysOld <= 3) return 0.9;
    if (daysOld <= 7) return 0.75;
    if (daysOld <= 14) return 0.6;
    if (daysOld <= 30) return 0.45;
    return 0.25;
  }

  private extractClaimKeywords(claim: string): string[] {
    return Array.from(
      new Set(
        claim
          .toLowerCase()
          .split(/[^a-z0-9]+/g)
          .filter(token => token.length >= 4)
      )
    ).slice(0, 25);
  }

  private computeKeywordCoverage(keywords: string[], text: string): number {
    if (!keywords.length) return 0.4;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) hits += 1;
    }
    return hits / keywords.length;
  }

  private scoreNewsArticle(article: NewsArticle, keywords: string[]): number {
    const keywordScore = this.computeKeywordCoverage(
      keywords,
      `${article.title ?? ''} ${article.snippet ?? ''}`
    );
    const recencyWeight = this.computeRecencyWeight(article.date);
    return keywordScore * 0.7 + recencyWeight * 0.3;
  }

  private scoreDocument(doc: Document, keywords: string[]): number {
    const metadata = doc.metadata as any;
    const keywordScore = this.computeKeywordCoverage(
      keywords,
      `${metadata?.title ?? ''} ${doc.pageContent ?? ''}`
    );
    const recencyWeight = this.computeRecencyWeight(metadata?.date ?? metadata?.published_at);
    return keywordScore * 0.65 + recencyWeight * 0.35;
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

  private mapEvidence(docs: Document[]): NewsArticle[] {
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
    const mapped = uniqueDocs.map(doc => {
      const link = this.extractLink(doc);
      return {
        title: this.safeField((doc.metadata as any)?.title ?? (doc.metadata as any)?.source ?? 'Untitled source'),
        snippet: this.safeField(doc.pageContent).slice(0, 200) + '...',
        link: link,
        date: this.safeField((doc.metadata as any)?.date),
        source: this.safeField((doc.metadata as any)?.source ?? 'Unknown'),
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
    
    // Return up to 8 sources with valid links
    return withLinks.slice(0, 8);
  }

  private async refineSummaryWithEvidence(
    summary: string,
    evidence: NewsArticle[],
    factCheckerOutput: string
  ): Promise<string> {
    if (!summary || evidence.length === 0) return summary;

    try {
      const evidenceLines = evidence.slice(0, 4).map((item, idx) => {
        const date = item.date || 'Unknown date';
        return `[#${idx + 1}] ${item.title ?? 'Untitled'} — ${item.source ?? 'Unknown'} (${date})`;
      });

      const prompt = `You are a fact-check QA assistant. Ensure the final summary reflects the most recent credible evidence.

Evidence:
${evidenceLines.join('\n')}

Fact Checker Output:
${factCheckerOutput}

Existing Summary:
"${summary}"

Rules:
- If the summary already aligns with the evidence and highlights the newest relevant sources, return it verbatim.
- Otherwise, rewrite it into 2-3 sentences referencing at least one evidence ID and date (e.g., "[#2, 11 Nov 2025]").
- Emphasize recency and certainty. Return ONLY the final summary text.`;

      const response = await this.llm.invoke(prompt);
      const refined =
        typeof response.content === 'string'
          ? response.content.trim()
          : JSON.stringify(response.content).trim();
      return refined || summary;
    } catch {
      return summary;
    }
  }

  // ==============================
  // SYNTHESIS — FINAL VERDICT
  // ==============================
  private async synthesizeResults(
    claim: string,
    analystOutput: string,
    evidence: EvidenceContext,
    factCheckerOutput: string
  ): Promise<AgenticVerificationResult> {
    this.step(`🎯 Stage 4 — Synthesizing results...`);

    // include top news headlines as extra context
    const topNewsLines = evidence.newsArticles.slice(0, 5).map(a =>
      `- "${a.title}" (Source: ${a.source ?? 'Unknown'}, Date: ${a.date})`
    );

    const synthesisPrompt = `You are a Synthesis Expert. Combine all agent outputs into a final verdict.

Claim:
"${claim}"

=== CLAIM ANALYST OUTPUT ===
${analystOutput}

=== EVIDENCE RESEARCHER OUTPUT ===
Search Queries: ${evidence.searchQueries.join(', ')}
News Articles Count: ${evidence.newsArticles.length}
KB Docs Count: ${evidence.kbDocs.length}

Top News Headlines:
${topNewsLines.join('\n')}

=== FACT CHECKER OUTPUT (TEXT) ===
${factCheckerOutput}

Important: The Fact Checker includes a line starting with "VERDICT:". You MUST respect and interpret it as:
- VERDICT: SUPPORTED   → the claim is factually supported by the evidence.
- VERDICT: REFUTED     → the claim is factually false according to the evidence.
- VERDICT: INCONCLUSIVE → the evidence is not strong/clear enough to decide.

Your job:
Return ONLY a valid JSON object with fields:

{
  "isVerified": boolean,
  "confidence": number,        // 0-100
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "analysis": "2-3 sentence technical analysis for internal use",
  "factCheckSummary": "2-3 sentence user-friendly explanation",
  "keyFindings": ["bullet 1", "bullet 2", "bullet 3"]
}

Mapping rules:
- If VERDICT is SUPPORTED:
    - "isVerified": true
    - "confidence": usually between 70 and 95 depending on how strong and consistent the evidence is.
- If VERDICT is REFUTED:
    - "isVerified": false
    - "confidence": usually between 70 and 95.
- If VERDICT is INCONCLUSIVE:
    - "isVerified": false
    - "confidence": 60 or lower.
- If evidence is weak or conflicting, set confidence <= 60 and riskLevel at least "MEDIUM".
- If you cannot decide AT ALL, treat it as INCONCLUSIVE and follow the rule above.
- Recency rule: Always prioritize the most recent credible evidence when reconciling conflicts, and highlight the newest sources in both the analysis and factCheckSummary.`;

    try {
      // Access detector's underlying model + JSON extractor in a type-safe-ish way
      const model = (this.detector as any).genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { maxOutputTokens: 800, temperature: 0.15 },
      });

      const result = await model.generateContent(synthesisPrompt);
      const rawText = result.response.text();
      const parsed = (this.detector as any).extractJsonFromResponse(rawText);

      this.step(`🎯 Synthesis completed`);

      const mappedEvidence = this.mapEvidence(evidence.kbDocs);
      const initialSummary =
        parsed.factCheckSummary ||
        'No clear conclusion available based on the current evidence.';
      const refinedSummary = await this.refineSummaryWithEvidence(
        initialSummary,
        mappedEvidence,
        factCheckerOutput
      );

      return {
        isVerified: Boolean(parsed.isVerified),
        confidence: Number(parsed.confidence ?? 50),
        riskLevel: (parsed.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') ?? 'MEDIUM',
        factCheckSummary: refinedSummary,
        analysis:
          parsed.analysis ||
          'Analysis generated from the combined outputs of claim analyst, evidence researcher, and fact checker.',
        evidence: mappedEvidence,
        agentInsights: {
          claimAnalyst: analystOutput,
          evidenceResearcher: evidence.summary,
          factChecker: factCheckerOutput,
          synthesizer: JSON.stringify(parsed.keyFindings ?? [], null, 2),
        },
        searchQueries: evidence.searchQueries,
        evidenceSources: evidence.kbDocs.length,
      };
    } catch {
      this.step(`⚠️ Synthesis fallback executed`);

      const mappedEvidence = this.mapEvidence(evidence.kbDocs);

      return {
        isVerified: false,
        confidence: 50,
        riskLevel: 'MEDIUM',
        factCheckSummary:
          'Evidence is inconclusive at this time. The claim should be treated as unverified and handled with caution.',
        analysis: 'Fallback synthesis executed due to an error in the primary synthesis model.',
        evidence: mappedEvidence,
        agentInsights: {
          claimAnalyst: analystOutput,
          evidenceResearcher: evidence.summary,
          factChecker: factCheckerOutput,
          synthesizer: 'Fallback synthesizer used; no structured key findings available.',
        },
        searchQueries: evidence.searchQueries,
        evidenceSources: evidence.kbDocs.length,
      };
    }
  }

  // ==============================
  // MAIN ENTRYPOINT
  // ==============================
  async verifyClaimAgentic(claim: string): Promise<AgenticVerificationResult> {
    this.step(`🤖 Starting Agentic Verification`);
    this.step(`📌 Claim: "${claim}"`);

    // 1) Claim analysis
    const analystOutput = await this.runClaimAnalyst(claim);

    // 2) Evidence research (Google News fetch → store → vector similarity)
    const evidenceContext = await this.runEvidenceResearcher(claim, analystOutput);

    // 3) Fact checker uses same evidence context
    const factCheckerOutput = await this.runFactChecker(
      claim,
      analystOutput,
      evidenceContext
    );

    // 4) Synthesis — final result
    const final = await this.synthesizeResults(
      claim,
      analystOutput,
      evidenceContext,
      factCheckerOutput
    );

    this.step(`🏁 Verification complete`);
    return final;
  }
}

export { AgenticRAGVerifier, AgenticVerificationResult };
