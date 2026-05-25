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
  buildRetrievalQueries,
  dedupeDocumentsByLink,
  extractKeywordTokens,
  formatArticleForEmbedding,
  MAX_ARTICLES_PER_NEWS_QUERY,
  MAX_ARTICLES_TO_INDEX,
  rankEvidenceCandidates,
  sanitizeNewsArticle,
} from './evidence-retrieval';
import { groqCompleteWithRetry } from './groq-llm';

// ==============================
// TYPES
// ==============================
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
        `✅ Stored ${documents.length} articles (cap ${MAX_ARTICLES_TO_INDEX}, ${articles.length} fetched)`
      );
    } catch (error) {
      console.error('❌ Error storing articles:', error);
      throw error;
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
    config?: { maxOutputTokens?: number; temperature?: number }
  ): Promise<string> {
    return groqCompleteWithRetry(prompt, {
      maxTokens: config?.maxOutputTokens ?? 500,
      temperature: config?.temperature ?? 0.1,
      retries: 1,
      requireJson: false,
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
      const jsonEnd = response.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const candidate = response
          .substring(jsonStart, jsonEnd + 1)
          .replace(/[\n\r]+/g, ' ')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');

        try {
          return JSON.parse(candidate);
        } catch {}
      }

      console.error('❌ Invalid JSON response text:', response);
      throw new Error('Invalid JSON in model response');
    }
  }

  // ==============================
  // CLAIM ANALYSIS
  // ==============================
  async analyzeClaim(claim: string): Promise<ClaimAnalysis> {
    const prompt = `
You must respond ONLY with a valid JSON object. Do not include explanations, text, or code fences.

Analyze this claim for fact-checking:

Claim: "${claim}"

Return JSON:
{
  "extractedClaims": ["claim1", "claim2"],
  "keywords": ["keyword1", "keyword2", "named entities"],
  "context": "short context",
  "searchQueries": [
    "specific Google News query with names/dates",
    "broader contextual query",
    "query with fact check or verification"
  ],
  "specificity": "vague/specific"
}`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 500,
        temperature: 0.1,
        requireJson: true,
      });
      const parsed = this.extractJsonFromResponse(response);

      const searchQueries = Array.isArray(parsed.searchQueries)
        ? parsed.searchQueries.filter((q: unknown) => typeof q === 'string' && q.trim())
        : [];

      return {
        claim,
        extractedClaims: parsed.extractedClaims || [claim],
        keywords: parsed.keywords || claim.split(' ').filter(w => w.length > 3),
        context: parsed.context || 'General claim verification',
        searchQueries: searchQueries.length > 0 ? searchQueries : await this.generateSearchQueries(claim),
      };
    } catch (error) {
      console.error('❌ Error parsing claim analysis:', error);
      return {
        claim,
        extractedClaims: [claim],
        keywords: claim.split(' ').filter(w => w.length > 3).slice(0, 5),
        context: 'General claim verification',
        searchQueries: await this.generateSearchQueries(claim),
      };
    }
  }

  async generateSearchQueries(claim: string, context?: string): Promise<string[]> {
    const prompt = `Generate exactly 3 Google News search queries to verify this claim.

Claim: "${claim}"
${context ? `Context: ${context}` : ''}

Rules:
- Query 1: very specific (include names, places, dates from the claim if present)
- Query 2: broader topic context
- Query 3: include "fact check" or "verification"
Return ONLY 3 lines, one query per line, no numbering or bullets.`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 200,
        temperature: 0.2,
        requireJson: false,
        retries: 1,
      });
      const queries = response
        .split('\n')
        .map((q) => q.replace(/^[\d.\-*)\s]+/, '').trim())
        .filter((q) => q.length > 8)
        .slice(0, 3);
      if (queries.length > 0) return queries;
    } catch (error) {
      console.warn('⚠️ Search query generation failed, using fallback:', error);
    }

    return [
      claim,
      `${claim.split(' ').slice(0, 8).join(' ')} news`,
      `${claim.split(' ').slice(0, 8).join(' ')} fact check`,
    ];
  }

  async fetchAndStoreEvidence(
    analysis: ClaimAnalysis,
    maxQueries: number = 3
  ): Promise<NewsArticle[]> {
    const queries = (analysis.searchQueries.length > 0
      ? analysis.searchQueries
      : await this.generateSearchQueries(analysis.claim, analysis.context)
    ).slice(0, maxQueries);

    const seenLinks = new Set<string>();
    const collected: NewsArticle[] = [];

    for (const query of queries) {
      if (collected.length >= MAX_ARTICLES_TO_INDEX) break;

      const articles = await this.fetchGoogleNewsSearch(query);
      for (const article of articles) {
        if (collected.length >= MAX_ARTICLES_TO_INDEX) break;
        const link = article.link?.toLowerCase().trim();
        if (!link || seenLinks.has(link)) continue;
        seenLinks.add(link);
        collected.push(article);
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    const toStore = collected.slice(0, MAX_ARTICLES_TO_INDEX);

    if (toStore.length > 0) {
      await this.storeNewsArticles(toStore);
    }

    return toStore;
  }

  // ==============================
  // EVIDENCE SEARCH
  // ==============================
  async findRelevantEvidence(
    claim: string,
    k: number = 12,
    analysis?: ClaimAnalysis,
    freshArticles: NewsArticle[] = []
  ): Promise<Document[]> {
    const queryContext: ClaimAnalysis =
      analysis ?? {
        claim,
        extractedClaims: [claim],
        keywords: claim.split(' ').filter((w) => w.length > 3).slice(0, 8),
        context: '',
        searchQueries: [],
      };

    const keywords = extractKeywordTokens(claim, queryContext.keywords);
    const candidates: Array<{ doc: Document; semanticScore: number }> = [];

    for (const article of freshArticles) {
      candidates.push({
        doc: new Document({
          pageContent: formatArticleForEmbedding(article),
          metadata: {
            title: article.title,
            link: article.link,
            date: article.date,
            source: article.source,
            type: 'news_article',
            fresh: true,
          },
        }),
        semanticScore: 0.92,
      });
    }

    if (this.vectorStore) {
      try {
        const retrievalQueries = buildRetrievalQueries(claim, queryContext);
        const fetchK = Math.max(k * 3, 24);

        const mmrDocs = await this.vectorStore.maxMarginalRelevanceSearch(claim, {
          k: Math.min(k, 10),
          fetchK,
          lambda: 0.65,
        });
        for (const doc of mmrDocs) {
          candidates.push({ doc, semanticScore: 0.85 });
        }

        for (const query of retrievalQueries) {
          const scored = await this.vectorStore.similaritySearchWithScore(query, 8);
          for (const [doc, score] of scored) {
            candidates.push({ doc, semanticScore: score });
          }
        }
      } catch (error) {
        console.error('❌ Error finding evidence:', error);
      }
    } else {
      console.warn('⚠️ Vector store not initialized — using fresh articles only');
    }

    const merged = new Map<string, { doc: Document; semanticScore: number }>();
    for (const { doc, semanticScore } of candidates) {
      const meta = doc.metadata as Record<string, string | undefined>;
      const key =
        meta.link?.toLowerCase().trim() ||
        `${meta.title ?? ''}::${doc.pageContent.slice(0, 80)}`;
      const prev = merged.get(key);
      if (!prev || semanticScore > prev.semanticScore) {
        merged.set(key, { doc, semanticScore });
      }
    }

    const ranked = rankEvidenceCandidates(
      Array.from(merged.values()),
      keywords,
      { minCombinedScore: 0.38, limit: k }
    );

    console.log(`🔎 Evidence: ${ranked.length} docs after ranking (${candidates.length} candidates)`);
    return ranked;
  }

  // ==============================
  // VERIFY CLAIM WITH EVIDENCE
  // ==============================
  async verifyClaimWithEvidence(
    claim: string,
    evidence: Document[],
    analysis: ClaimAnalysis
  ): Promise<VerificationResult> {
    const evidenceText = evidence
      .map(
        (doc, i) =>
          `Evidence ${i + 1}: ${doc.pageContent}\nSource: ${doc.metadata.source}\nDate: ${doc.metadata.date}\n---`
      )
      .join('\n');

    const prompt = `
You must respond ONLY with a valid JSON object. Do not include explanations, text, or code fences.

You are a fact-checker. Verify the following claim using the provided evidence.

Claim: "${claim}"
Extracted Sub-Claims: ${analysis.extractedClaims.join(', ')}

Evidence (ranked by relevance to the claim; #1 is strongest match):
${evidenceText}

Guidelines:
- Prefer evidence that directly addresses the claim's entities, dates, and assertions.
- When sources conflict, favor recent credible reporting, but do not ignore strong older evidence that directly refutes or supports the claim.
- Keep reasoning concise but precise so downstream systems can explain the recency trade-offs.

Return JSON:
{
  "isVerified": true/false,
  "confidence": 85,
  "riskLevel": "LOW/MEDIUM/HIGH",
  "analysis": "detailed reasoning",
  "factCheckSummary": "public summary"
}`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 600,
        temperature: 0.1,
        requireJson: true,
      });
      const parsed = this.extractJsonFromResponse(response);

      const relevantArticles: NewsArticle[] = evidence.map((doc) => {
        const meta = doc.metadata as Record<string, string | undefined>;
        return {
          title: meta.title ?? 'Untitled',
          snippet: doc.pageContent.substring(0, 200) + '...',
          link: meta.link ?? '',
          date: meta.date ?? 'Unknown date',
          source: meta.source ?? 'Unknown',
        };
      });

      return {
        isVerified: parsed.isVerified || false,
        confidence: parsed.confidence || 0,
        evidence: relevantArticles,
        analysis: parsed.analysis || 'Unable to analyze claim',
        riskLevel: parsed.riskLevel || 'MEDIUM',
        factCheckSummary: parsed.factCheckSummary || 'Unable to verify claim',
      };
    } catch (error) {
      console.error('❌ Error in claim verification:', error);
      return {
        isVerified: false,
        confidence: 0,
        evidence: [],
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
      const freshNews = await this.fetchAndStoreEvidence(analysis, 3);

      console.log('🔎 Finding relevant evidence...');
      const evidence = await this.findRelevantEvidence(claim, 12, analysis, freshNews);

      if (evidence.length === 0)
        return {
          isVerified: false,
          confidence: 0,
          evidence: [],
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


export { MisinformationDetector, VerificationResult, NewsArticle, ClaimAnalysis, };
