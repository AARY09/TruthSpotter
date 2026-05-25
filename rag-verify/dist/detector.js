"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MisinformationDetector = void 0;
require("dotenv/config");
const qdrant_1 = require("@langchain/qdrant");
const documents_1 = require("@langchain/core/documents");
const serpapi_1 = require("serpapi");
const js_client_rest_1 = require("@qdrant/js-client-rest");
const embeddings_1 = require("./embeddings");
const evidence_retrieval_1 = require("./evidence-retrieval");
const groq_llm_1 = require("./groq-llm");
// ==============================
// CLASS: MisinformationDetector
// ==============================
class MisinformationDetector {
    constructor() {
        this.vectorStore = null;
        (0, embeddings_1.requireHuggingfaceApiKey)();
        if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY)
            throw new Error('QDRANT_URL and QDRANT_API_KEY are required');
        this.embeddings = new embeddings_1.HuggingFaceEmbeddings();
        // qdrantClient will be created lazily in initializeVectorStore with
        // resilient URL handling (some Qdrant Cloud endpoints require different
        // host/port/path combinations). This avoids hard-failing at construction
        // time and lets initializeVectorStore attempt fallbacks.
        this.qdrantClient = null;
    }
    getCollectionVectorSize(collectionInfo) {
        const vectors = collectionInfo.config?.params?.vectors;
        if (!vectors || typeof vectors !== 'object')
            return undefined;
        if ('size' in vectors && typeof vectors.size === 'number') {
            return vectors.size;
        }
        const named = Object.values(vectors);
        const first = named.find((v) => typeof v?.size === 'number');
        return first?.size;
    }
    async ensureCollectionDimension(collectionName) {
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
            console.warn(`⚠️ Collection "${collectionName}" uses ${actualSize} dims but embeddings are ${expectedSize}. Recreating (old vectors will be removed).`);
            await this.qdrantClient.deleteCollection(collectionName);
            await this.qdrantClient.createCollection(collectionName, {
                vectors: { size: expectedSize, distance: 'Cosine' },
            });
            console.log(`✅ Recreated Qdrant collection "${collectionName}" (${expectedSize} dims)`);
        }
    }
    getRecencyScore(value) {
        if (!value)
            return 0;
        const strValue = typeof value === 'string' ? value : (() => {
            try {
                return String(value);
            }
            catch {
                return '';
            }
        })();
        const parsed = Date.parse(strValue);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    // ==============================
    // INIT VECTOR STORE
    // ==============================
    static defaultCollectionName() {
        if (process.env.QDRANT_COLLECTION)
            return process.env.QDRANT_COLLECTION;
        const slug = embeddings_1.HF_EMBED_MODEL.split('/').pop()?.replace(/[^a-z0-9]+/gi, '_') ?? 'embed';
        return `news_${slug}`;
    }
    async initializeVectorStore(collectionName = MisinformationDetector.defaultCollectionName()) {
        try {
            // Ensure qdrant client exists and try a few URL fallbacks if necessary.
            const rawUrl = process.env.QDRANT_URL;
            const apiKey = process.env.QDRANT_API_KEY;
            const triedErrors = [];
            const tryUrls = Array.from(new Set([
                rawUrl,
                // remove explicit port if present (Qdrant Cloud usually works on 443)
                rawUrl?.replace(/:6333\/?$/, ''),
                // some Qdrant Cloud deployments expose API under /api
                rawUrl?.replace(/:\d+\/?$/, '') + '/api',
            ].filter(Boolean)));
            let collections = null;
            for (const u of tryUrls) {
                try {
                    this.qdrantClient = new js_client_rest_1.QdrantClient({ url: u, apiKey, checkCompatibility: false });
                    collections = await this.qdrantClient.getCollections();
                    // success
                    break;
                }
                catch (err) {
                    triedErrors.push({ url: u, err });
                    // continue to next fallback
                }
            }
            if (!collections) {
                // attach information about tried URLs to the thrown error for debugging
                const e = new Error('Failed to contact Qdrant with provided QDRANT_URL');
                e.details = triedErrors;
                throw e;
            }
            await this.ensureCollectionDimension(collectionName);
            this.vectorStore = new qdrant_1.QdrantVectorStore(this.embeddings, {
                client: this.qdrantClient,
                collectionName,
            });
            console.log(`✅ Vector store initialized with collection: ${collectionName}`);
        }
        catch (error) {
            console.error('❌ Error initializing vector store:', error);
            throw error;
        }
    }
    // ==============================
    // FETCH GOOGLE NEWS
    // ==============================
    async fetchGoogleNewsSearch(query) {
        try {
            const params = {
                engine: 'google_news',
                q: query,
                hl: 'en',
                gl: 'in',
                num: evidence_retrieval_1.MAX_ARTICLES_PER_NEWS_QUERY,
                api_key: process.env.SERPAPI_KEY,
            };
            const results = await (0, serpapi_1.getJson)(params);
            const articles = results.news_results
                ?.map((article) => (0, evidence_retrieval_1.sanitizeNewsArticle)(article))
                .slice(0, evidence_retrieval_1.MAX_ARTICLES_PER_NEWS_QUERY) || [];
            return articles.sort((a, b) => this.getRecencyScore(b.date) - this.getRecencyScore(a.date));
        }
        catch (error) {
            console.error('❌ Error fetching news:', error);
            return [];
        }
    }
    // ==============================
    // STORE ARTICLES
    // ==============================
    async storeNewsArticles(articles) {
        if (!this.vectorStore) {
            console.warn('⚠️ Vector store not initialized, skipping storage of articles');
            return;
        }
        try {
            const valid = articles.filter((a) => (a.title || a.snippet) && a.link.startsWith('http'));
            const documents = (0, evidence_retrieval_1.dedupeDocumentsByLink)((0, evidence_retrieval_1.articlesToDocuments)(valid)).slice(0, evidence_retrieval_1.MAX_ARTICLES_TO_INDEX);
            if (documents.length === 0)
                return;
            await this.vectorStore.addDocuments(documents);
            console.log(`✅ Stored ${documents.length} articles (cap ${evidence_retrieval_1.MAX_ARTICLES_TO_INDEX}, ${articles.length} fetched)`);
        }
        catch (error) {
            console.error('❌ Error storing articles:', error);
            throw error;
        }
    }
    // ==============================
    // PUBLIC HELPER: JSON TASK RUNNER
    // ==============================
    async runJsonTask(prompt, config) {
        try {
            const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
                maxTokens: config?.maxOutputTokens ?? 800,
                temperature: config?.temperature ?? 0.15,
                requireJson: true,
            });
            return this.extractJsonFromResponse(response);
        }
        catch (error) {
            console.error('❌ Error in JSON task:', error);
            throw error;
        }
    }
    /** Plain-text completion for routing / casual chat */
    async generateCompletion(prompt, config) {
        return (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
            maxTokens: config?.maxOutputTokens ?? 500,
            temperature: config?.temperature ?? 0.1,
            retries: 1,
            requireJson: false,
        });
    }
    // ==============================
    // PUBLIC HELPER: GET EMBEDDING DIMENSION
    // ==============================
    getEmbeddingDimension() {
        return embeddings_1.HF_EMBEDDING_DIMENSION;
    }
    // ==============================
    // PUBLIC HELPER: CHECK VECTOR STORE STATUS
    // ==============================
    isVectorStoreInitialized() {
        return this.vectorStore !== null;
    }
    // ==============================
    // PUBLIC HELPER: SAFE JSON PARSER
    // ==============================
    extractJsonFromResponse(response) {
        try {
            return JSON.parse(response);
        }
        catch {
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim());
                }
                catch { }
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
                }
                catch { }
            }
            console.error('❌ Invalid JSON response text:', response);
            throw new Error('Invalid JSON in model response');
        }
    }
    // ==============================
    // CLAIM ANALYSIS
    // ==============================
    async analyzeClaim(claim) {
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
            const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
                maxTokens: 500,
                temperature: 0.1,
                requireJson: true,
            });
            const parsed = this.extractJsonFromResponse(response);
            const searchQueries = Array.isArray(parsed.searchQueries)
                ? parsed.searchQueries.filter((q) => typeof q === 'string' && q.trim())
                : [];
            return {
                claim,
                extractedClaims: parsed.extractedClaims || [claim],
                keywords: parsed.keywords || claim.split(' ').filter(w => w.length > 3),
                context: parsed.context || 'General claim verification',
                searchQueries: searchQueries.length > 0 ? searchQueries : await this.generateSearchQueries(claim),
            };
        }
        catch (error) {
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
    async generateSearchQueries(claim, context) {
        const prompt = `Generate exactly 3 Google News search queries to verify this claim.

Claim: "${claim}"
${context ? `Context: ${context}` : ''}

Rules:
- Query 1: very specific (include names, places, dates from the claim if present)
- Query 2: broader topic context
- Query 3: include "fact check" or "verification"
Return ONLY 3 lines, one query per line, no numbering or bullets.`;
        try {
            const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
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
            if (queries.length > 0)
                return queries;
        }
        catch (error) {
            console.warn('⚠️ Search query generation failed, using fallback:', error);
        }
        return [
            claim,
            `${claim.split(' ').slice(0, 8).join(' ')} news`,
            `${claim.split(' ').slice(0, 8).join(' ')} fact check`,
        ];
    }
    async fetchAndStoreEvidence(analysis, maxQueries = 3) {
        const queries = (analysis.searchQueries.length > 0
            ? analysis.searchQueries
            : await this.generateSearchQueries(analysis.claim, analysis.context)).slice(0, maxQueries);
        const seenLinks = new Set();
        const collected = [];
        for (const query of queries) {
            if (collected.length >= evidence_retrieval_1.MAX_ARTICLES_TO_INDEX)
                break;
            const articles = await this.fetchGoogleNewsSearch(query);
            for (const article of articles) {
                if (collected.length >= evidence_retrieval_1.MAX_ARTICLES_TO_INDEX)
                    break;
                const link = article.link?.toLowerCase().trim();
                if (!link || seenLinks.has(link))
                    continue;
                seenLinks.add(link);
                collected.push(article);
            }
            await new Promise((r) => setTimeout(r, 600));
        }
        const toStore = collected.slice(0, evidence_retrieval_1.MAX_ARTICLES_TO_INDEX);
        if (toStore.length > 0) {
            await this.storeNewsArticles(toStore);
        }
        return toStore;
    }
    // ==============================
    // EVIDENCE SEARCH
    // ==============================
    async findRelevantEvidence(claim, k = 12, analysis, freshArticles = []) {
        const queryContext = analysis ?? {
            claim,
            extractedClaims: [claim],
            keywords: claim.split(' ').filter((w) => w.length > 3).slice(0, 8),
            context: '',
            searchQueries: [],
        };
        const keywords = (0, evidence_retrieval_1.extractKeywordTokens)(claim, queryContext.keywords);
        const candidates = [];
        for (const article of freshArticles) {
            candidates.push({
                doc: new documents_1.Document({
                    pageContent: (0, evidence_retrieval_1.formatArticleForEmbedding)(article),
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
                const retrievalQueries = (0, evidence_retrieval_1.buildRetrievalQueries)(claim, queryContext);
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
            }
            catch (error) {
                console.error('❌ Error finding evidence:', error);
            }
        }
        else {
            console.warn('⚠️ Vector store not initialized — using fresh articles only');
        }
        const merged = new Map();
        for (const { doc, semanticScore } of candidates) {
            const meta = doc.metadata;
            const key = meta.link?.toLowerCase().trim() ||
                `${meta.title ?? ''}::${doc.pageContent.slice(0, 80)}`;
            const prev = merged.get(key);
            if (!prev || semanticScore > prev.semanticScore) {
                merged.set(key, { doc, semanticScore });
            }
        }
        const ranked = (0, evidence_retrieval_1.rankEvidenceCandidates)(Array.from(merged.values()), keywords, { minCombinedScore: 0.38, limit: k });
        console.log(`🔎 Evidence: ${ranked.length} docs after ranking (${candidates.length} candidates)`);
        return ranked;
    }
    // ==============================
    // VERIFY CLAIM WITH EVIDENCE
    // ==============================
    async verifyClaimWithEvidence(claim, evidence, analysis) {
        const evidenceText = evidence
            .map((doc, i) => `Evidence ${i + 1}: ${doc.pageContent}\nSource: ${doc.metadata.source}\nDate: ${doc.metadata.date}\n---`)
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
            const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
                maxTokens: 600,
                temperature: 0.1,
                requireJson: true,
            });
            const parsed = this.extractJsonFromResponse(response);
            const relevantArticles = evidence.map((doc) => {
                const meta = doc.metadata;
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
        }
        catch (error) {
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
    async updateNewsDatabase(topics) {
        console.log('🔄 Updating news database...');
        for (const topic of topics) {
            try {
                console.log(`📰 Fetching news for: ${topic}`);
                const articles = (await this.fetchGoogleNewsSearch(topic)).slice(0, evidence_retrieval_1.MAX_ARTICLES_TO_INDEX);
                if (articles.length > 0)
                    await this.storeNewsArticles(articles);
                await new Promise(r => setTimeout(r, 2000));
            }
            catch (error) {
                console.error(`❌ Error updating topic ${topic}:`, error);
            }
        }
    }
    // ==============================
    // MAIN CLAIM VERIFICATION
    // ==============================
    async verifyClaim(claim) {
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
                    factCheckSummary: 'Insufficient evidence found. Please consult official news sources.',
                };
            console.log('✅ Verifying claim with evidence...');
            const result = await this.verifyClaimWithEvidence(claim, evidence, analysis);
            console.log(`🎯 Verification complete - Verified: ${result.isVerified}`);
            return result;
        }
        catch (error) {
            console.error('❌ Error in verification process:', error);
            throw error;
        }
    }
}
exports.MisinformationDetector = MisinformationDetector;
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
        const testClaim = 'Farmers in India are protesting because the government banned all traditional farming methods in 2025';
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
    }
    catch (error) {
        console.error('❌ Error in main:', error);
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=detector.js.map