"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RumorWatcher = void 0;
const agent_orchestrator_1 = require("./agent-orchestrator");
// ==============================
// RUMOR WATCHER CLASS
// ==============================
class RumorWatcher {
    constructor(detector, onUpdate) {
        this.orchestrator = null;
        this.processedUrls = new Set();
        this.detector = detector;
        this.onUpdate = onUpdate;
    }
    log(message) {
        console.log(`[RumorWatcher] ${message}`);
        this.onUpdate?.(message);
    }
    // ==============================
    // FETCH DAILY RUMORS/NEWS
    // ==============================
    /**
     * Fetches daily rumors and viral news from Google News
     * Uses various search queries to find potential misinformation
     */
    async fetchDailyRumors(maxArticles = 20) {
        this.log('🔍 Fetching daily rumors and viral news...');
        const searchQueries = [
            'viral rumors',
            'breaking news rumors',
            'fact check news',
            'viral hoax',
            'misinformation trending',
            'debunked claims',
            'social media rumors',
            'trending conspiracy',
        ];
        const allArticles = [];
        const seenUrls = new Set();
        try {
            for (const query of searchQueries.slice(0, 4)) { // Limit to 4 queries to avoid rate limits
                this.log(`📰 Searching for: "${query}"`);
                const articles = await this.detector.fetchGoogleNewsSearch(query);
                for (const article of articles) {
                    // Deduplicate by URL
                    if (!seenUrls.has(article.link) && article.link) {
                        seenUrls.add(article.link);
                        allArticles.push(article);
                        if (allArticles.length >= maxArticles) {
                            break;
                        }
                    }
                }
                if (allArticles.length >= maxArticles) {
                    break;
                }
                // Small delay to prevent rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            this.log(`✅ Fetched ${allArticles.length} unique articles`);
            return allArticles.slice(0, maxArticles);
        }
        catch (error) {
            this.log(`❌ Error fetching rumors: ${error?.message || 'Unknown error'}`);
            return [];
        }
    }
    // ==============================
    // EXTRACT CLAIMS FROM ARTICLES
    // ==============================
    /**
     * Extracts verifiable claims from news articles using AI
     */
    async extractClaimsFromArticle(article) {
        try {
            return await this.detector.extractClaimsFromArticle(article);
        }
        catch (error) {
            this.log(`⚠️ Error extracting claims from article: ${error?.message || 'Unknown error'}`);
            // Fallback: use title as claim
            return article.title.length > 20 ? [article.title] : [];
        }
    }
    // ==============================
    // VERIFY CLAIMS
    // ==============================
    /**
     * Verifies a claim using the AgentOrchestrator
     */
    async verifyClaim(claim) {
        if (!this.orchestrator) {
            this.orchestrator = new agent_orchestrator_1.AgentOrchestrator(this.detector, this.onUpdate);
        }
        try {
            this.log(`🔍 Verifying claim: "${claim.substring(0, 80)}..."`);
            const result = await this.orchestrator.verifyClaimAgentic(claim);
            this.log(`✅ Verification complete - Verified: ${result.isVerified}, Confidence: ${result.confidence}%`);
            return result;
        }
        catch (error) {
            this.log(`❌ Error verifying claim: ${error?.message || 'Unknown error'}`);
            throw error;
        }
    }
    // ==============================
    // PROCESS ARTICLE
    // ==============================
    /**
     * Processes a single article: extracts claims and verifies them
     */
    async processArticle(article) {
        // Skip if already processed
        if (this.processedUrls.has(article.link)) {
            this.log(`⏭️ Skipping already processed article: ${article.title}`);
            return {
                article,
                extractedClaims: [],
                verifications: [],
                timestamp: new Date().toISOString(),
            };
        }
        this.log(`\n📄 Processing article: "${article.title}"`);
        this.log(`🔗 Source: ${article.source || 'Unknown'} | Date: ${article.date}`);
        // Extract claims
        const claims = await this.extractClaimsFromArticle(article);
        this.log(`📌 Extracted ${claims.length} claim(s)`);
        // Verify each claim
        const verifications = [];
        for (const claim of claims) {
            try {
                const verification = await this.verifyClaim(claim);
                verifications.push(verification);
                // Small delay between verifications
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (error) {
                this.log(`⚠️ Failed to verify claim: ${claim.substring(0, 50)}...`);
            }
        }
        // Mark as processed
        this.processedUrls.add(article.link);
        return {
            article,
            extractedClaims: claims,
            verifications,
            timestamp: new Date().toISOString(),
        };
    }
    // ==============================
    // RUN DAILY WATCH
    // ==============================
    /**
     * Main method: fetches daily rumors, extracts claims, and verifies them
     */
    async runDailyWatch(maxArticles = 10) {
        const startTime = Date.now();
        const startTimeISO = new Date().toISOString();
        this.log('\n' + '='.repeat(60));
        this.log('🕵️ Starting Daily Rumor Watch');
        this.log('='.repeat(60) + '\n');
        const results = [];
        try {
            // 1. Fetch daily rumors
            const articles = await this.fetchDailyRumors(maxArticles);
            if (articles.length === 0) {
                this.log('⚠️ No articles found. Watch completed.');
                return {
                    results: [],
                    stats: {
                        articlesProcessed: 0,
                        claimsExtracted: 0,
                        verificationsCompleted: 0,
                        startTime: startTimeISO,
                        endTime: new Date().toISOString(),
                        durationMs: Date.now() - startTime,
                    },
                };
            }
            this.log(`\n📊 Processing ${articles.length} articles...\n`);
            // 2. Process each article
            let totalClaims = 0;
            let totalVerifications = 0;
            for (let i = 0; i < articles.length; i++) {
                const article = articles[i];
                this.log(`\n[${i + 1}/${articles.length}] Processing article...`);
                try {
                    const result = await this.processArticle(article);
                    results.push(result);
                    totalClaims += result.extractedClaims.length;
                    totalVerifications += result.verifications.length;
                    // Delay between articles to prevent rate limits
                    if (i < articles.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
                catch (error) {
                    this.log(`❌ Error processing article: ${error?.message || 'Unknown error'}`);
                }
            }
            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const stats = {
                articlesProcessed: results.length,
                claimsExtracted: totalClaims,
                verificationsCompleted: totalVerifications,
                startTime: startTimeISO,
                endTime: new Date().toISOString(),
                durationMs,
            };
            this.log('\n' + '='.repeat(60));
            this.log('✅ Daily Rumor Watch Completed');
            this.log('='.repeat(60));
            this.log(`📊 Stats:`);
            this.log(`   - Articles Processed: ${stats.articlesProcessed}`);
            this.log(`   - Claims Extracted: ${stats.claimsExtracted}`);
            this.log(`   - Verifications Completed: ${stats.verificationsCompleted}`);
            this.log(`   - Duration: ${(durationMs / 1000).toFixed(2)}s`);
            this.log('='.repeat(60) + '\n');
            return { results, stats };
        }
        catch (error) {
            this.log(`❌ Fatal error in daily watch: ${error?.message || 'Unknown error'}`);
            throw error;
        }
    }
    // ==============================
    // CLEAR PROCESSED CACHE
    // ==============================
    /**
     * Clears the cache of processed URLs (useful for testing or reset)
     */
    clearProcessedCache() {
        this.processedUrls.clear();
        this.log('🗑️ Cleared processed URLs cache');
    }
    // ==============================
    // GET PROCESSED COUNT
    // ==============================
    /**
     * Returns the number of articles already processed
     */
    getProcessedCount() {
        return this.processedUrls.size;
    }
}
exports.RumorWatcher = RumorWatcher;
//# sourceMappingURL=rumor-watcher.js.map