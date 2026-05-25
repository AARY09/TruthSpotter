"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optimizeSearchQueries = exports.MisinformationDetector = void 0;
require("dotenv/config");
const qdrant_1 = require("@langchain/qdrant");
const serpapi_1 = require("serpapi");
const js_client_rest_1 = require("@qdrant/js-client-rest");
const embeddings_1 = require("./embeddings");
const evidence_retrieval_1 = require("./evidence-retrieval");
const query_optimizer_1 = require("./query-optimizer");
const retrieval_pipeline_1 = require("./retrieval-pipeline");
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
            console.log(`✅ Indexed ${documents.length} articles (max ${evidence_retrieval_1.MAX_ARTICLES_TO_INDEX})`);
        }
        catch (error) {
            console.error('❌ Error storing articles:', error);
            throw error;
        }
    }
    /** Non-blocking index — verification continues if HuggingFace times out */
    async storeNewsArticlesSafe(articles) {
        try {
            await this.storeNewsArticles(articles);
            return true;
        }
        catch {
            return false;
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
        const searchPlan = await (0, query_optimizer_1.optimizeSearchQueries)(claim);
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
            const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
                maxTokens: 400,
                temperature: 0.1,
                requireJson: true,
            });
            const parsed = this.extractJsonFromResponse(response);
            return {
                claim,
                extractedClaims: parsed.extractedClaims || [claim],
                keywords: parsed.keywords?.length > 0
                    ? parsed.keywords
                    : searchPlan.claimKeywords,
                context: parsed.context || 'General claim verification',
                searchQueries: searchPlan.allQueries,
                searchPlan,
            };
        }
        catch (error) {
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
    async generateSearchQueries(claim) {
        const plan = await (0, query_optimizer_1.optimizeSearchQueries)(claim);
        return plan.allQueries;
    }
    async fetchAndStoreEvidence(analysis) {
        const plan = analysis.searchPlan;
        const articles = await (0, retrieval_pipeline_1.fetchNewsForPlan)(plan, (q) => this.fetchGoogleNewsSearch(q));
        await (0, retrieval_pipeline_1.indexArticlesSafe)(articles, (a) => this.storeNewsArticlesSafe(a));
        return articles;
    }
    // ==============================
    // EVIDENCE SEARCH
    // ==============================
    async findRelevantEvidence(claim, k = evidence_retrieval_1.MAX_EVIDENCE_RESULTS, analysis, freshArticles = []) {
        const plan = analysis?.searchPlan ?? (await (0, query_optimizer_1.optimizeSearchQueries)(claim));
        return (0, retrieval_pipeline_1.retrieveEvidence)(plan, this.vectorStore, freshArticles, k);
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
            const freshNews = await this.fetchAndStoreEvidence(analysis);
            console.log('🔎 Finding relevant evidence...');
            const evidence = await this.findRelevantEvidence(claim, evidence_retrieval_1.MAX_EVIDENCE_RESULTS, analysis, freshNews);
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
var query_optimizer_2 = require("./query-optimizer");
Object.defineProperty(exports, "optimizeSearchQueries", { enumerable: true, get: function () { return query_optimizer_2.optimizeSearchQueries; } });
//# sourceMappingURL=detector.js.map