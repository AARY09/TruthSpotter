import { MisinformationDetector, NewsArticle } from './detector';
import { AgentOrchestrator, AgenticVerificationResult } from './agent-orchestrator';

// ==============================
// TYPES
// ==============================

export interface RumorWatcherResult {
  article: NewsArticle;
  extractedClaims: string[];
  verifications: AgenticVerificationResult[];
  timestamp: string;
}

export interface WatcherStats {
  articlesProcessed: number;
  claimsExtracted: number;
  verificationsCompleted: number;
  startTime: string;
  endTime: string;
  durationMs: number;
}

// ==============================
// RUMOR WATCHER CLASS
// ==============================

export class RumorWatcher {
  private detector: MisinformationDetector;
  private orchestrator: AgentOrchestrator | null = null;
  private processedUrls: Set<string> = new Set();
  private onUpdate?: (message: string) => void;

  constructor(detector: MisinformationDetector, onUpdate?: (message: string) => void) {
    this.detector = detector;
    this.onUpdate = onUpdate;
  }

  private log(message: string) {
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
  async fetchDailyRumors(maxArticles: number = 20): Promise<NewsArticle[]> {
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

    const allArticles: NewsArticle[] = [];
    const seenUrls = new Set<string>();

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
    } catch (error: any) {
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
  async extractClaimsFromArticle(article: NewsArticle): Promise<string[]> {
    try {
      return await this.detector.extractClaimsFromArticle(article);
    } catch (error: any) {
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
  async verifyClaim(claim: string): Promise<AgenticVerificationResult> {
    if (!this.orchestrator) {
      this.orchestrator = new AgentOrchestrator(this.detector, this.onUpdate);
    }

    try {
      this.log(`🔍 Verifying claim: "${claim.substring(0, 80)}..."`);
      const result = await this.orchestrator.verifyClaimAgentic(claim);
      this.log(`✅ Verification complete - Verified: ${result.isVerified}, Confidence: ${result.confidence}%`);
      return result;
    } catch (error: any) {
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
  async processArticle(article: NewsArticle): Promise<RumorWatcherResult> {
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
    const verifications: AgenticVerificationResult[] = [];
    for (const claim of claims) {
      try {
        const verification = await this.verifyClaim(claim);
        verifications.push(verification);
        
        // Small delay between verifications
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
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
  async runDailyWatch(maxArticles: number = 10): Promise<{
    results: RumorWatcherResult[];
    stats: WatcherStats;
  }> {
    const startTime = Date.now();
    const startTimeISO = new Date().toISOString();

    this.log('\n' + '='.repeat(60));
    this.log('🕵️ Starting Daily Rumor Watch');
    this.log('='.repeat(60) + '\n');

    const results: RumorWatcherResult[] = [];

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
        } catch (error: any) {
          this.log(`❌ Error processing article: ${error?.message || 'Unknown error'}`);
        }
      }

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      const stats: WatcherStats = {
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
    } catch (error: any) {
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
  clearProcessedCache(): void {
    this.processedUrls.clear();
    this.log('🗑️ Cleared processed URLs cache');
  }

  // ==============================
  // GET PROCESSED COUNT
  // ==============================

  /**
   * Returns the number of articles already processed
   */
  getProcessedCount(): number {
    return this.processedUrls.size;
  }
}

