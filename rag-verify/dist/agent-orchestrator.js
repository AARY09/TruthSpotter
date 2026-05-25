"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = void 0;
// ==============================
// ORCHESTRATOR CLASS
// ==============================
class AgentOrchestrator {
    constructor(detector, onUpdate, context) {
        this.agentInsights = {
            claimAnalyst: '',
            evidenceResearcher: '',
            factChecker: '',
            synthesizer: '',
        };
        this.searchQueries = [];
        this.evidenceDocs = [];
        this.isRunning = false;
        this.timeoutMs = 120000; // 2 minutes timeout
        this.detector = detector;
        this.onUpdate = onUpdate;
        this.context = context;
        if (!process.env.GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY is required');
        }
    }
    step(message) {
        console.log(message);
        this.onUpdate?.(message);
    }
    normalizeUrl(url) {
        if (!url || typeof url !== 'string')
            return null;
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
        }
        catch {
            return url.toLowerCase().trim();
        }
    }
    normalizeText(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    extractLink(doc) {
        const metadata = doc.metadata;
        // Check multiple possible fields for links
        return metadata?.link || metadata?.url || metadata?.href || undefined;
    }
    isValidLink(link) {
        if (!link || typeof link !== 'string')
            return false;
        const trimmed = link.trim();
        // Check if it's a valid URL format
        return trimmed.length > 0 && (trimmed.startsWith('http://') || trimmed.startsWith('https://'));
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
    mapEvidenceToNewsArticles(docs) {
        // First, deduplicate documents at the Document level based on metadata
        const docSeen = new Set();
        const uniqueDocs = [];
        for (const doc of docs) {
            const docLink = this.extractLink(doc);
            const docTitle = doc.metadata?.title ?? doc.metadata?.source ?? '';
            const docSource = doc.metadata?.source ?? 'Unknown';
            let docKey;
            const normalizedLink = this.normalizeUrl(docLink);
            if (normalizedLink) {
                docKey = normalizedLink;
            }
            else {
                const normalizedTitle = this.normalizeText(docTitle);
                const normalizedSource = this.normalizeText(docSource);
                docKey = `${normalizedTitle}|${normalizedSource}`;
            }
            if (!docSeen.has(docKey)) {
                docSeen.add(docKey);
                uniqueDocs.push(doc);
            }
        }
        uniqueDocs.sort((a, b) => this.getRecencyScore(b.metadata?.date ?? b.metadata?.published_at) -
            this.getRecencyScore(a.metadata?.date ?? a.metadata?.published_at));
        // Map the deduplicated documents and extract links from multiple fields
        const mapped = uniqueDocs.map((doc) => {
            const link = this.extractLink(doc);
            return {
                title: doc.metadata?.title ?? doc.metadata?.source ?? 'Untitled source',
                snippet: (doc.pageContent || '').slice(0, 150) + '...',
                link: link,
                date: doc.metadata?.date ?? 'Unknown date',
                source: doc.metadata?.source ?? 'Unknown',
            };
        });
        // Deduplicate again at the NewsArticle level (double-check)
        const seen = new Set();
        const unique = [];
        for (const article of mapped) {
            let key;
            // Use normalized link as primary key if available
            const normalizedLink = this.normalizeUrl(article.link);
            if (normalizedLink) {
                key = normalizedLink;
            }
            else {
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
        const withLinks = [];
        for (const article of unique) {
            if (this.isValidLink(article.link) && article.link) {
                withLinks.push({
                    ...article,
                    link: article.link
                });
            }
        }
        // Return up to 5 sources with valid links
        return withLinks.slice(0, 5);
    }
    cleanup() {
        // Clear large objects to free memory
        this.evidenceDocs = [];
        this.searchQueries = [];
        this.isRunning = false;
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }
    async verifyClaimAgentic(claim, context) {
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
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Verification timeout')), this.timeoutMs);
        });
        try {
            // Step 0: Route the query
            const queryType = await this.routeQuery(claim);
            // Run with timeout based on query type
            let resultPromise;
            if (queryType === 'casual') {
                resultPromise = this.handleCasualQuery(claim);
            }
            else {
                resultPromise = this.runVerification(claim);
            }
            const result = await Promise.race([resultPromise, timeoutPromise]);
            return result;
        }
        catch (error) {
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
        }
        finally {
            this.cleanup();
        }
    }
    // Router step: Classify query and route accordingly
    async routeQuery(query) {
        this.step(`🔀 Routing query...`);
        try {
            // Use a simple LLM call to classify the query
            const classificationPrompt = `Classify the following user query as either "CASUAL" or "VERIFICATION_REQUIRED".

Query: "${query}"

Rules:
- CASUAL: Conversational questions, general knowledge, opinions, creative requests, or questions that don't require fact-checking
- VERIFICATION_REQUIRED: Claims, statements, or questions that assert factual information that needs verification

Respond with ONLY one word: either "CASUAL" or "VERIFICATION_REQUIRED"`;
            const classification = (await this.detector.generateCompletion(classificationPrompt, {
                maxOutputTokens: 10,
                temperature: 0.1,
            }))
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
        }
        catch (error) {
            this.step(`⚠️ Classification failed, defaulting to VERIFICATION_REQUIRED`);
        }
        // Default to verification if classification fails
        return 'verification';
    }
    // Handle casual queries - use direct LLM call instead of full agents SDK to avoid memory issues
    async handleCasualQuery(query) {
        this.step(`💬 Handling casual query...`);
        try {
            // Use a simple, direct LLM call instead of the full agents SDK stack
            // This avoids memory issues and is more efficient for casual queries
            const casualPrompt = `You are a helpful, friendly AI assistant. Answer the following question in a clear, conversational, and helpful manner.

Question: "${query}"

Provide a helpful response. Be concise but informative.`;
            this.step(`🤖 Generating response...`);
            const casualResponse = (await this.detector.generateCompletion(casualPrompt, {
                maxOutputTokens: 500,
                temperature: 0.7,
            })).trim();
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
        }
        catch (error) {
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
    async runVerification(claim) {
        try {
            // Stage 1: Analyze claim with lighter model
            const analysis = await this.detector.analyzeClaim(claim);
            this.agentInsights.claimAnalyst = `Extracted ${analysis.extractedClaims.length} sub-claims`;
            this.step(`✅ Claim Analyst completed`);
            // Stage 2: Targeted news fetch + index
            this.step(`📚 Stage 2 — Evidence Researcher running...`);
            this.searchQueries = analysis.searchQueries;
            const freshArticles = await this.detector.fetchAndStoreEvidence(analysis, 3);
            this.agentInsights.evidenceResearcher = `Fetched ${freshArticles.length} articles for ${this.searchQueries.length} queries`;
            this.step(`✅ Evidence Researcher completed (${freshArticles.length} articles)`);
            // Stage 3: Hybrid retrieval (semantic + keywords + recency)
            this.step(`🔎 Stage 3 — Finding relevant evidence...`);
            this.evidenceDocs = await this.detector.findRelevantEvidence(claim, 12, analysis, freshArticles);
            this.step(`✅ Retrieved ${this.evidenceDocs.length} relevant evidence documents`);
            // Stage 4: Fact checking
            this.step(`⚖️ Stage 4 — Fact Checker running...`);
            const verification = await this.detector.verifyClaimWithEvidence(claim, this.evidenceDocs, analysis);
            this.agentInsights.factChecker = `Verdict: ${verification.isVerified ? 'SUPPORTED' : 'REFUTED/INCONCLUSIVE'}`;
            this.step(`✅ Fact Checker completed`);
            // Build final result
            const mappedEvidence = this.mapEvidenceToNewsArticles(this.evidenceDocs);
            const finalResult = {
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
        }
        catch (error) {
            throw new Error(`Verification failed: ${error?.message || 'Unknown error'}`);
        }
    }
}
exports.AgentOrchestrator = AgentOrchestrator;
//# sourceMappingURL=agent-orchestrator.js.map