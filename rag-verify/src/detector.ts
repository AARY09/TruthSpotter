import 'dotenv/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { getJson } from 'serpapi';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  GROQ_EMBEDDING_DIMENSION,
  GROQ_EMBED_MODEL,
  GROQ_OPENAI_BASE_URL,
  requireGroqApiKey,
} from './groq-config';
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
}

// ==============================
// CLASS: MisinformationDetector
// ==============================
class MisinformationDetector {
  private embeddings: OpenAIEmbeddings;
  private qdrantClient: QdrantClient;
  private vectorStore: QdrantVectorStore | null = null;
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    const groqApiKey = requireGroqApiKey();
    if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY)
      throw new Error('QDRANT_URL and QDRANT_API_KEY are required');

    this.embeddings = new OpenAIEmbeddings({
      apiKey: groqApiKey,
      model: GROQ_EMBED_MODEL,
      configuration: { baseURL: GROQ_OPENAI_BASE_URL },
    });

    // qdrantClient will be created lazily in initializeVectorStore with
    // resilient URL handling (some Qdrant Cloud endpoints require different
    // host/port/path combinations). This avoids hard-failing at construction
    // time and lets initializeVectorStore attempt fallbacks.
    this.qdrantClient = null as unknown as QdrantClient;

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
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
  async initializeVectorStore(collectionName: string = 'news_articles'): Promise<void> {
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

      const collectionExists = collections.collections.some((col: any) => col.name === collectionName);

      if (!collectionExists) {
        await this.qdrantClient.createCollection(collectionName, {
          vectors: { size: this.getEmbeddingDimension(), distance: 'Cosine' },
        });
      }

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
        num: 20,
        api_key: process.env.SERPAPI_KEY,
      };

      const results = await getJson(params);
      const articles =
        results.news_results?.map((article: any) => ({
          title: article.title,
          snippet: article.snippet,
          link: article.link,
          date: article.date,
          source: article.source,
        })) || [];

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
      const documents: Document[] = [];

      for (const article of articles) {
        const content = `Title: ${article.title}\nSnippet: ${article.snippet}\nDate: ${article.date}\nSource: ${
          article.source || 'Unknown'
        }`;

        const chunks = await this.textSplitter.splitText(content);

        for (const chunk of chunks) {
          documents.push(
            new Document({
              pageContent: chunk,
              metadata: {
                title: article.title,
                link: article.link,
                date: article.date,
                source: article.source,
                type: 'news_article',
              },
            })
          );
        }
      }

      await this.vectorStore.addDocuments(documents);
      console.log(`✅ Stored ${documents.length} chunks from ${articles.length} articles`);
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
    return GROQ_EMBEDDING_DIMENSION;
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
  "keywords": ["keyword1", "keyword2"],
  "context": "short context",
  "specificity": "vague/specific"
}`;

    try {
      const response = await groqCompleteWithRetry(prompt, {
        maxTokens: 500,
        temperature: 0.1,
        requireJson: true,
      });
      const parsed = this.extractJsonFromResponse(response);

      return {
        claim,
        extractedClaims: parsed.extractedClaims || [claim],
        keywords: parsed.keywords || claim.split(' ').filter(w => w.length > 3),
        context: parsed.context || 'General claim verification',
      };
    } catch (error) {
      console.error('❌ Error parsing claim analysis:', error);
      return {
        claim,
        extractedClaims: [claim],
        keywords: claim.split(' ').filter(w => w.length > 3).slice(0, 5),
        context: 'General claim verification',
      };
    }
  }

  // ==============================
  // EVIDENCE SEARCH
  // ==============================
  async findRelevantEvidence(claim: string, k: number = 10): Promise<Document[]> {
    if (!this.vectorStore) {
      console.warn('⚠️ Vector store not initialized — similarity search unavailable');
      return [];
    }

    try {
      return await this.vectorStore.similaritySearch(claim, k);
    } catch (error) {
      console.error('❌ Error finding evidence:', error);
      return [];
    }
  }

  // ==============================
  // VERIFY CLAIM WITH EVIDENCE
  // ==============================
  async verifyClaimWithEvidence(
    claim: string,
    evidence: Document[],
    analysis: ClaimAnalysis
  ): Promise<VerificationResult> {
    const sortedEvidence = [...evidence].sort(
      (a, b) =>
        this.getRecencyScore((b.metadata as any)?.date ?? (b.metadata as any)?.published_at) -
        this.getRecencyScore((a.metadata as any)?.date ?? (a.metadata as any)?.published_at)
    );

    const evidenceText = sortedEvidence
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

Evidence (sorted with newest first):
${evidenceText}

Guidelines:
- ALWAYS prioritize the most recent credible evidence. If newer and older sources conflict, trust the newer data unless it is clearly unreliable.
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

      const relevantArticles: NewsArticle[] = sortedEvidence.map((doc) => {
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
        const articles = await this.fetchGoogleNewsSearch(topic);
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

      console.log('📰 Fetching related news...');
      const searchQueries = analysis.keywords.slice(0, 3).join(' ');
      const freshNews = await this.fetchGoogleNewsSearch(searchQueries);
      if (freshNews.length > 0) await this.storeNewsArticles(freshNews);

      console.log('🔎 Finding relevant evidence...');
      let evidenceRaw: Document[] = [];

      // If vector store is not initialized, fall back to using freshly fetched
      // news as candidate evidence (no similarity ranking available).
      if (!this.isVectorStoreInitialized() && freshNews.length > 0) {
        evidenceRaw = freshNews.map((a: any) =>
          new Document({
            pageContent: `Title: ${a.title}\nSnippet: ${a.snippet}\nDate: ${a.date}\nSource: ${a.source || 'Unknown'}`,
            metadata: {
              title: a.title,
              link: a.link,
              date: a.date,
              source: a.source,
            },
          })
        );
      } else {
        evidenceRaw = await this.findRelevantEvidence(claim, 20);
      }
      const evidence = evidenceRaw.sort(
        (a, b) =>
          this.getRecencyScore((b.metadata as any)?.date ?? (b.metadata as any)?.published_at) -
          this.getRecencyScore((a.metadata as any)?.date ?? (a.metadata as any)?.published_at)
      );

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
