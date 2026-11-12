import 'dotenv/config';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import { getJson } from 'serpapi';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  HF_EMBED_MODEL,
  HF_EMBEDDING_DIMENSION,
  HuggingFaceEmbeddings,
  requireHuggingfaceApiKey,
} from './embeddings';
import {
  articlesToDocuments,
  dedupeDocumentsByLink,
  MAX_ARTICLES_PER_NEWS_QUERY,
  MAX_ARTICLES_TO_INDEX,
  MAX_EVIDENCE_RESULTS,
  sanitizeNewsArticle,
} from './evidence-retrieval';
import { optimizeSearchQueries, type OptimizedSearchPlan } from './query-optimizer';
import {
  fetchNewsForPlan,
  indexArticlesSafe,
  retrieveEvidence,
} from './retrieval-pipeline';
import { groqCompleteWithRetry } from './groq-llm';

// ==============================
// TYPES
// ==============================
export type EvidenceStance = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL_CONTEXT';

export interface NewsArticle {
  id?: string;
  citationNumber?: number;
  title: string;
  snippet: string;
  link: string;
  date: string;
  url?: string;
  source?: string;
  publisher?: string;
  stance?: EvidenceStance;
  finding?: string;
  highlightedQuote?: string;
  supportsVerdict?: boolean;
}

export interface FactualStatement {
  statement: string;
  citationIds: string[];
  citationNumbers: number[];
  sources?: { id: string; title: string; publisher: string; link: string }[];
}

export interface VerificationResult {
  isVerified: boolean;
  confidence: number;
  evidence: NewsArticle[];
  supportingEvidence: NewsArticle[];
  contradictingEvidence: NewsArticle[];
  contextEvidence: NewsArticle[];
  factualStatements: FactualStatement[];
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

// ==============================
// CLASS: MisinformationDetector
// ==============================
class MisinformationDetector {
  private embeddings: HuggingFaceEmbeddings;
  private qdrantClient: QdrantClient;
  private vectorStore: QdrantVectorStore | null = null;

  constructor() {
    requireHuggingfaceApiKey();
    if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY)
      throw new Error('QDRANT_URL and QDRANT_API_KEY are required');

    this.embeddings = new HuggingFaceEmbeddings();

    // qdrantClient will be created lazily in initializeVectorStore with
    // resilient URL handling (some Qdrant Cloud endpoints require different
    // host/port/path combinations). This avoids hard-failing at construction
    // time and lets initializeVectorStore attempt fallbacks.
    this.qdrantClient = null as unknown as QdrantClient;
  }

  private getCollectionVectorSize(collectionInfo: {
    config?: { params?: { vectors?: unknown } };
  }): number | undefined {
    const vectors = collectionInfo.config?.params?.vectors;
    if (!vectors || typeof vectors !== 'object') return undefined;
    if ('size' in vectors && typeof (vectors as { size: unknown }).size === 'number') {
      return (vectors as { size: number }).size;
    }
    const named = Object.values(vectors as Record<string, { size?: number }>);
    const first = named.find((v) => typeof v?.size === 'number');
    return first?.size;
  }

  private async ensureCollectionDimension(collectionName: string): Promise<void> {
    const expectedSize = this.getEmbeddingDimension();
    const { collections } = await this.qdrantClient.getCollections();
    const exists = collections.some((col) => col.name === collectionName);

    if (!exists) {
      await this.qdrantClient.createCollection(collectionName, {
        vectors: { size: expectedSize, distance: 'Cosine' },
      });
      console.log(`✅ Created Qdrant collection "${collectionName}" (${expectedSize} dims)`);
      return;
    }

    const info = await this.qdrantClient.getCollection(collectionName);
    const actualSize = this.getCollectionVectorSize(info);

    if (actualSize !== undefined && actualSize !== expectedSize) {
      console.warn(
        `⚠️ Collection "${collectionName}" uses ${actualSize} dims but embeddings are ${expectedSize}. Recreating (old vectors will be removed).`
      );
      await this.qdrantClient.deleteCollection(collectionName);
      await this.qdrantClient.createCollection(collectionName, {
        vectors: { size: expectedSize, distance: 'Cosine' },
      });
      console.log(`✅ Recreated Qdrant collection "${collectionName}" (${expectedSize} dims)`);
    }
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

  // ==============================
  // INIT VECTOR STORE
  // ==============================
  static defaultCollectionName(): string {
    if (process.env.QDRANT_COLLECTION) return process.env.QDRANT_COLLECTION;
    const slug = HF_EMBED_MODEL.split('/').pop()?.replace(/[^a-z0-9]+/gi, '_') ?? 'embed';
    return `news_${slug}`;
  }

  async initializeVectorStore(collectionName: string = MisinformationDetector.defaultCollectionName()): Promise<void> {
    try {
      // Ensure qdrant client exists and try a few URL fallbacks if necessary.
      const rawUrl = process.env.QDRANT_URL as string;
      const apiKey = process.env.QDRANT_API_KEY as string;

      const triedErrors: any[] = [];
      const tryUrls = Array.from(
        new Set([
          rawUrl,
          // remove explicit port if present (Qdrant Cloud usually works on 443)
          rawUrl?.replace(/:6333\/?$/, ''),
          // some Qdrant Cloud deployments expose API under /api
          rawUrl?.replace(/:\d+\/?$/, '') + '/api',
        ].filter(Boolean))
      );

      let collections: any = null;

      for (const u of tryUrls) {
        try {
          this.qdrantClient = new QdrantClient({ url: u, apiKey, checkCompatibility: false } as any);
          collections = await this.qdrantClient.getCollections();
          // success
          break;
        } catch (err: any) {
          triedErrors.push({ url: u, err });
          // continue to next fallback
        }
      }

      if (!collections) {
        // attach information about tried URLs to the thrown error for debugging
        const e: any = new Error('Failed to contact Qdrant with provided QDRANT_URL');
        e.details = triedErrors;
        throw e;
      }

      await this.ensureCollectionDimension(collectionName);

      this.vectorStore = new QdrantVectorStore(this.embeddings, {
        client: this.qdrantClient,
        collectionName,
      });

      console.log(`✅ Vector store initialized with collection: ${collectionName}`);
    } catch (error) {
      console.error('❌ Error initializing vector store:', error);
      throw error;
    }
  }

  // ==============================
  // FETCH GOOGLE NEWS
  // ==============================
  async fetchGoogleNewsSearch(query: string): Promise<NewsArticle[]> {
    try {
      const params = {
        engine: 'google_news',
        q: query,
        hl: 'en',
        gl: 'in',
        num: MAX_ARTICLES_PER_NEWS_QUERY,
        api_key: process.env.SERPAPI_KEY,
      };

      const results = await getJson(params);
      const articles =
        results.news_results
          ?.map((article) =>
            sanitizeNewsArticle(article as unknown as Record<string, unknown>)
          )
          .slice(0, MAX_ARTICLES_PER_NEWS_QUERY) || [];

      return articles.sort((a: NewsArticle, b: NewsArticle) => this.getRecencyScore(b.date) - this.getRecencyScore(a.date));
    } catch (error) {
      console.error('❌ Error fetching news:', error);
      return [];
    }
  }

  // ==============================
  // STORE ARTICLES
  // ==============================
  async storeNewsArticles(articles: NewsArticle[]): Promise<void> {
    if (!this.vectorStore) {
      console.warn('⚠️ Vector store not initialized, skipping storage of articles');
      return;
    }

    try {
      const valid = articles.filter(
        (a) => (a.title || a.snippet) && a.link.startsWith('http')
      );
      const documents = dedupeDocumentsByLink(articlesToDocuments(valid)).slice(
        0,
        MAX_ARTICLES_TO_INDEX
      );

      if (documents.length === 0) return;

      await this.vectorStore.addDocuments(documents);
      console.log(
        `✅ Indexed ${documents.length} articles (max ${MAX_ARTICLES_TO_INDEX})`
      );
    } catch (error) {
      console.error('❌ Error storing articles:', error);
      throw error;
    }
  }

  /** Non-blocking index — verification continues if HuggingFace times out */
  async storeNewsArticlesSafe(articles: NewsArticle[]): Promise<boolean> {
    try {
      await this.storeNewsArticles(articles);
      return true;
    } catch {
      return false;
    }
  }

  // ==============================
  // PUBLIC HELPER: JSON TASK RUNNER
  // ==============================
  async runJsonTask(prompt: string, config?: { maxOutputTokens?: number; temperature?: number }): Promise<any> {
    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: config?.maxOutputTokens ?? 800,
        temperature: config?.temperature ?? 0.15,
        requireJson: true,
      });
      return this.extractJsonFromResponse(response);
    } catch (error) {
      console.error('❌ Error in JSON task:', error);
      throw error;
    }
  }

  /** Plain-text completion for routing / casual chat */
  async generateCompletion(
    prompt: string,
    config?: { maxOutputTokens?: number; temperature?: number; operation?: string }
  ): Promise<string> {
    return groqCompleteWithRetry(prompt, {
      maxTokens: config?.maxOutputTokens ?? 500,
      temperature: config?.temperature ?? 0.1,
      retries: 1,
      requireJson: false,
      operation: config?.operation ?? 'generateCompletion',
    });
  }

  // ==============================
  // PUBLIC HELPER: GET EMBEDDING DIMENSION
  // ==============================
  getEmbeddingDimension(): number {
    return HF_EMBEDDING_DIMENSION;
  }

  // ==============================
  // PUBLIC HELPER: CHECK VECTOR STORE STATUS
  // ==============================
  isVectorStoreInitialized(): boolean {
    return this.vectorStore !== null;
  }

  // ==============================
  // PUBLIC HELPER: SAFE JSON PARSER
  // ==============================
  extractJsonFromResponse(response: string): any {
    try {
      return JSON.parse(response);
    } catch {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1].trim());
        } catch {}
      }

      const jsonStart = response.indexOf('{');
      if (jsonStart !== -1) {
        const candidate = response.substring(jsonStart).trim();
        const jsonEnd = candidate.lastIndexOf('}');
        if (jsonEnd !== -1) {
          try {
            return JSON.parse(
              candidate
                .substring(0, jsonEnd + 1)
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
            );
          } catch {}
        }

        // Auto-repair truncated JSON: find the last complete object in array
        const lastBrace = candidate.lastIndexOf('},');
        if (lastBrace !== -1) {
          const repaired = candidate.substring(0, lastBrace + 1) + ']}';
          try {
            return JSON.parse(
              repaired.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
            );
          } catch {}
        }
      }

      console.error('❌ Invalid JSON response text:', response);
      throw new Error('Invalid JSON in model response');
    }
  }

  // ==============================
  // CLAIM ANALYSIS
  // ==============================
  async analyzeClaim(claim: string): Promise<ClaimAnalysis> {
    const searchPlan = await optimizeSearchQueries(claim);

    const prompt = `
Respond ONLY with valid JSON. Analyze this claim for fact-checking (do NOT invent facts not in the claim).

Claim: "${claim}"

Return JSON:
{
  "extractedClaims": ["sub-claim1", "sub-claim2"],
  "keywords": ["terms from the claim only"],
  "context": "one short sentence of topic context",
  "specificity": "vague" or "specific"
}`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 800,
        temperature: 0.1,
        requireJson: true,
        operation: 'claimAnalyst',
      });
      const parsed = this.extractJsonFromResponse(response);

      return {
        claim,
        extractedClaims: parsed.extractedClaims || [claim],
        keywords:
          parsed.keywords?.length > 0
            ? parsed.keywords
            : searchPlan.claimKeywords,
        context: parsed.context || 'General claim verification',
        searchQueries: searchPlan.allQueries,
        searchPlan,
      };
    } catch (error) {
      console.error('❌ Error parsing claim analysis:', error);
      return {
        claim,
        extractedClaims: [claim],
        keywords: searchPlan.claimKeywords,
        context: 'General claim verification',
        searchQueries: searchPlan.allQueries,
        searchPlan,
      };
    }
  }

  /** Groq-optimized search queries (≤15 words, no hallucinated entities) */
  async generateSearchQueries(claim: string): Promise<string[]> {
    const plan = await optimizeSearchQueries(claim);
    return plan.allQueries;
  }

  async fetchAndStoreEvidence(analysis: ClaimAnalysis): Promise<NewsArticle[]> {
    const plan = analysis.searchPlan;
    const articles = await fetchNewsForPlan(plan, (q) => this.fetchGoogleNewsSearch(q));
    await indexArticlesSafe(articles, (a) => this.storeNewsArticlesSafe(a));
    return articles;
  }

  // ==============================
  // EVIDENCE SEARCH
  // ==============================
  async findRelevantEvidence(
    claim: string,
    k: number = MAX_EVIDENCE_RESULTS,
    analysis?: ClaimAnalysis,
    freshArticles: NewsArticle[] = []
  ): Promise<Document[]> {
    const plan =
      analysis?.searchPlan ?? (await optimizeSearchQueries(claim));

    return retrieveEvidence(plan, this.vectorStore, freshArticles, k);
  }

  // ==============================
  // VERIFY CLAIM WITH EVIDENCE
  // ==============================
  async verifyClaimWithEvidence(
    claim: string,
    evidence: Document[],
    analysis: ClaimAnalysis
  ): Promise<VerificationResult> {
    const evidenceItemsFormatted = evidence.slice(0, 6).map((doc, idx) => {
      const meta = doc.metadata as Record<string, any>;
      const id = meta.id || `doc_${idx + 1}`;
      const title = meta.title || 'Untitled Article';
      const source = meta.publisher || meta.source || 'Unknown Publisher';
      const date = meta.date || 'Unknown date';
      const url = meta.link || meta.url || '';
      const snippet = meta.snippet || doc.pageContent.slice(0, 300);

      return {
        id,
        citationNumber: idx + 1,
        title,
        source,
        publisher: source,
        date,
        url,
        link: url,
        snippet,
        doc,
      };
    });

    const evidenceText = evidenceItemsFormatted
      .map(
        (item) =>
          `[Evidence ${item.id}] (Citation [${item.citationNumber}])\nTitle: ${item.title}\nPublisher: ${item.publisher}\nDate: ${item.date}\nURL: ${item.url}\nContent: ${item.snippet}\n---`
      )
      .join('\n');

    const prompt = `
You must respond ONLY with a valid JSON object. Do not include markdown code fences, comments, or extra text.

You are an expert fact-checker and investigative journalist. Thoroughly evaluate the user's claim against the provided evidence articles.

Claim: "${claim}"
Extracted Sub-Claims: ${analysis.extractedClaims.join(', ')}

Evidence Articles:
${evidenceText || 'No direct news articles found.'}

Instructions:
1. Evaluate EVERY evidence article provided above:
   - id: The exact evidence ID (e.g. "doc_1", "doc_2", etc.)
   - stance: "SUPPORTS" (directly verifies/confirms the claim), "CONTRADICTS" (refutes/debunks/contradicts the claim), or "NEUTRAL_CONTEXT" (reports warnings, background, or context without confirming or denying)
   - finding: A concise 1-sentence description of what this specific article reports regarding the claim (max 25 words).
   - highlightedQuote: 1 key verbatim sentence/phrase from the article text that backs up your finding (max 25 words).
   - supportsVerdict: boolean (true if this article's evidence aligns with your final verdict; false if it opposes or is neutral)

2. Synthesize 2 to 4 major factual statements establishing the verdict:
   - statement: Clear factual statement
   - citationIds: Array of evidence IDs supporting this statement (e.g. ["doc_1", "doc_2"])

3. Determine the overall verdict:
   - isVerified: true if the evidence supports the claim; false if the evidence refutes the claim or if it is false/unsupported.
   - confidence: 0 to 100 confidence score based on the weight of evidence.
   - riskLevel: "LOW" (credible / true), "MEDIUM" (mixed / context / unverified), or "HIGH" (false / misleading / misinformation).
   - factCheckSummary: A clear, authoritative summary of the fact-check verdict. Include inline citations like [1], [2] referencing the citation numbers of evidence sources.
   - analysis: Detailed, clear multi-sentence explanation breaking down what the evidence says, the timeline, sources, and reasons for the verdict. Include inline citations [1], [2].

Return JSON in this exact structure:
{
  "isVerified": false,
  "confidence": 95,
  "riskLevel": "HIGH",
  "factCheckSummary": "The claim is false [1]. Multiple sources confirmed no such event occurred [1], [2].",
  "analysis": "...",
  "evidenceFindings": [
    {
      "id": "doc_1",
      "stance": "CONTRADICTS",
      "finding": "Contradicts the claim by confirming no incident occurred.",
      "highlightedQuote": "...",
      "supportsVerdict": true
    }
  ],
  "factualStatements": [
    {
      "statement": "...",
      "citationIds": ["doc_1"]
    }
  ]
}`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 3500,
        temperature: 0.1,
        requireJson: true,
        operation: 'factChecker',
      });
      const parsed = this.extractJsonFromResponse(response);

      const rawFindings = Array.isArray(parsed.evidenceFindings) ? parsed.evidenceFindings : [];

      const enrichedArticles: NewsArticle[] = evidenceItemsFormatted.map((item, idx) => {
        const findingMatch = rawFindings.find(
          (f: any) =>
            f.id === item.id ||
            f.id === `doc_${item.citationNumber}` ||
            f.id === String(item.citationNumber) ||
            f.id === `doc_${idx + 1}` ||
            f.id === String(idx + 1)
        ) || rawFindings[idx];

        let stance: EvidenceStance = 'NEUTRAL_CONTEXT';
        if (findingMatch?.stance) {
          const upper = String(findingMatch.stance).toUpperCase();
          if (upper.includes('SUPPORT')) stance = 'SUPPORTS';
          else if (upper.includes('CONTRADICT') || upper.includes('REFUTE') || upper.includes('FALSE')) stance = 'CONTRADICTS';
        } else {
          stance = parsed.isVerified ? 'SUPPORTS' : 'CONTRADICTS';
        }

        const finding =
          findingMatch?.finding ||
          (stance === 'SUPPORTS'
            ? 'Supports the claim based on reported evidence'
            : stance === 'CONTRADICTS'
            ? 'Contradicts or refutes the claim'
            : 'Provides contextual background on the claim');

        const highlightedQuote =
          findingMatch?.highlightedQuote ||
          item.snippet ||
          'No direct quote available.';

        const supportsVerdict =
          findingMatch?.supportsVerdict ??
          (stance === 'SUPPORTS' ? parsed.isVerified : !parsed.isVerified);

        return {
          id: item.id,
          citationNumber: item.citationNumber,
          title: item.title,
          snippet: item.snippet,
          link: item.link,
          url: item.url,
          date: item.date,
          source: item.source,
          publisher: item.publisher,
          stance,
          finding,
          highlightedQuote,
          supportsVerdict,
        };
      });

      const supportingEvidence = enrichedArticles.filter((a) => a.stance === 'SUPPORTS');
      const contradictingEvidence = enrichedArticles.filter((a) => a.stance === 'CONTRADICTS');
      const contextEvidence = enrichedArticles.filter((a) => a.stance === 'NEUTRAL_CONTEXT');

      // Map factual statements with citations
      const rawStatements = Array.isArray(parsed.factualStatements) ? parsed.factualStatements : [];
      const factualStatements: FactualStatement[] = rawStatements.map((stmt: any) => {
        const citationIds: string[] = Array.isArray(stmt.citationIds)
          ? stmt.citationIds.map(String)
          : [];
        const matchedArticles = enrichedArticles.filter(
          (a) =>
            citationIds.includes(a.id || '') ||
            citationIds.includes(`doc_${a.citationNumber}`) ||
            citationIds.includes(String(a.citationNumber))
        );
        return {
          statement: String(stmt.statement || ''),
          citationIds,
          citationNumbers: matchedArticles.map((a) => a.citationNumber || 1),
          sources: matchedArticles.map((a) => ({
            id: a.id || '',
            title: a.title,
            publisher: a.publisher || a.source || 'Unknown',
            link: a.link,
          })),
        };
      });

      return {
        isVerified: parsed.isVerified ?? false,
        confidence: parsed.confidence ?? 0,
        evidence: enrichedArticles,
        supportingEvidence,
        contradictingEvidence,
        contextEvidence,
        factualStatements,
        analysis: parsed.analysis || 'Unable to analyze claim',
        riskLevel: parsed.riskLevel || 'MEDIUM',
        factCheckSummary: parsed.factCheckSummary || 'Unable to verify claim',
      };
    } catch (error) {
      console.error('❌ Error in claim verification:', error);
      const fallbackArticles: NewsArticle[] = evidence.map((doc, idx) => {
        const meta = doc.metadata as Record<string, any>;
        const link = meta.link || meta.url || '';
        const source = meta.publisher || meta.source || 'Unknown';
        return {
          id: meta.id || `doc_${idx + 1}`,
          citationNumber: idx + 1,
          title: meta.title || 'Untitled',
          snippet: doc.pageContent.substring(0, 200) + '...',
          link,
          url: link,
          date: meta.date || 'Unknown date',
          source,
          publisher: source,
          stance: 'NEUTRAL_CONTEXT',
          finding: 'Analyzed in connection with the claim',
          highlightedQuote: doc.pageContent.substring(0, 150),
          supportsVerdict: false,
        };
      });

      return {
        isVerified: false,
        confidence: 0,
        evidence: fallbackArticles,
        supportingEvidence: [],
        contradictingEvidence: [],
        contextEvidence: fallbackArticles,
        factualStatements: [],
        analysis: 'Error occurred during verification',
        riskLevel: 'MEDIUM',
        factCheckSummary: 'Verification failed due to model error',
      };
    }
  }

  // ==============================
  // UPDATE DATABASE
  // ==============================
  async updateNewsDatabase(topics: string[]): Promise<void> {
    console.log('🔄 Updating news database...');
    for (const topic of topics) {
      try {
        console.log(`📰 Fetching news for: ${topic}`);
        const articles = (await this.fetchGoogleNewsSearch(topic)).slice(
          0,
          MAX_ARTICLES_TO_INDEX
        );
        if (articles.length > 0) await this.storeNewsArticles(articles);
        await new Promise(r => setTimeout(r, 2000));
      } catch (error) {
        console.error(`❌ Error updating topic ${topic}:`, error);
      }
    }
  }

  // ==============================
  // MAIN CLAIM VERIFICATION
  // ==============================
  async verifyClaim(claim: string): Promise<VerificationResult> {
    try {
      console.log(`🔍 Starting verification for claim: "${claim}"`);
      const analysis = await this.analyzeClaim(claim);

      console.log('📰 Fetching targeted news for claim...');
      const freshNews = await this.fetchAndStoreEvidence(analysis);

      console.log('🔎 Finding relevant evidence...');
      const evidence = await this.findRelevantEvidence(
        claim,
        MAX_EVIDENCE_RESULTS,
        analysis,
        freshNews
      );

      if (evidence.length === 0)
        return {
          isVerified: false,
          confidence: 0,
          evidence: [],
          supportingEvidence: [],
          contradictingEvidence: [],
          contextEvidence: [],
          factualStatements: [],
          analysis: 'No relevant evidence found',
          riskLevel: 'MEDIUM',
          factCheckSummary:
            'Insufficient evidence found. Please consult official news sources.',
        };

      console.log('✅ Verifying claim with evidence...');
      const result = await this.verifyClaimWithEvidence(claim, evidence, analysis);
      console.log(`🎯 Verification complete - Verified: ${result.isVerified}`);
      return result;
    } catch (error) {
      console.error('❌ Error in verification process:', error);
      throw error;
    }
  }
}

// ==============================
// MAIN FUNCTION
// ==============================
async function main() {
  try {
    const detector = new MisinformationDetector();
    await detector.initializeVectorStore();

    const topics = [
      'farmers protest india 2025',
      'government policy agriculture',
      'farmer bills india',
      'agricultural reforms india',
    ];

    await detector.updateNewsDatabase(topics);

    const testClaim =
      'Farmers in India are protesting because the government banned all traditional farming methods in 2025';

    console.log('\n🚀 Testing claim verification...');
    const result = await detector.verifyClaim(testClaim);

    console.log('\n📊 VERIFICATION RESULT:');
    console.log('====================');
    console.log(`Claim: ${testClaim}`);
    console.log(`Verified: ${result.isVerified ? '✅ True' : '❌ False/Unverified'}`);
    console.log(`Confidence: ${result.confidence}%`);
    console.log(`Risk Level: ${result.riskLevel}`);
    console.log(`\nAnalysis: ${result.analysis}`);
    console.log(`\nSummary: ${result.factCheckSummary}`);
  } catch (error) {
    console.error('❌ Error in main:', error);
  }
}

if (require.main === module) {
  main();
}


export { MisinformationDetector, ClaimAnalysis };
export { optimizeSearchQueries } from './query-optimizer';
