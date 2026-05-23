import { FunctionTool, RunContext } from '@openai/agents';
import { MisinformationDetector, NewsArticle, ClaimAnalysis } from './detector';
import { Document } from '@langchain/core/documents';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { VerificationContext } from './agent-orchestrator';

// ==============================
// TOOL SCHEMAS
// ==============================

const AnalyzeClaimSchema = z.object({
  claim: z.string().describe('The claim to analyze'),
});

const SearchNewsSchema = z.object({
  query: z.string().describe('Search query for Google News'),
});

const StoreArticlesSchema = z.object({
  articles: z.array(z.object({
    title: z.string(),
    snippet: z.string(),
    link: z.string(),
    date: z.string(),
    source: z.string().optional(),
  })).describe('Array of news articles to store'),
});

const RetrieveEvidenceSchema = z.object({
  claim: z.string().describe('The claim to find evidence for'),
  k: z.number().optional().default(10).describe('Number of evidence documents to retrieve'),
});

// ==============================
// TOOL IMPLEMENTATIONS
// ==============================

export function createAgentTools(detector: MisinformationDetector) {
  return {
    analyze_claim: {
      name: 'analyze_claim',
      description: 'Analyze a claim to extract sub-claims, keywords, and context for fact-checking',
      parameters: zodToJsonSchema(AnalyzeClaimSchema) as unknown as any,
      invoke: async (runContext: RunContext<VerificationContext>, input: string): Promise<ClaimAnalysis> => {
        try {
          const context = runContext?.context;
          if (context?.userName) {
            console.log(`🔍 Analyzing claim for user: ${context.userName} (Request: ${context.requestId})`);
          }
          const args = AnalyzeClaimSchema.parse(JSON.parse(input));
          return await detector.analyzeClaim(args.claim);
        } catch (error: any) {
          console.error('❌ Error in analyze_claim tool:', error);
          throw new Error(`Failed to analyze claim: ${error?.message || 'Unknown error'}`);
        }
      },
      strict: true,
      type: 'function' as const,
    } as FunctionTool,

    search_news: {
      name: 'search_news',
      description: 'Search Google News for articles related to a query',
      parameters: zodToJsonSchema(SearchNewsSchema) as any,
      invoke: async (runContext: RunContext<VerificationContext>, input: string): Promise<NewsArticle[]> => {
        try {
          const context = runContext?.context;
          if (context?.requestId) {
            console.log(`📰 Searching news for request: ${context.requestId}`);
          }
          const args = SearchNewsSchema.parse(JSON.parse(input));
          return await detector.fetchGoogleNewsSearch(args.query);
        } catch (error: any) {
          console.error('❌ Error in search_news tool:', error);
          throw new Error(`Failed to search news: ${error?.message || 'Unknown error'}`);
        }
      },
      strict: true,
      type: 'function' as const,
    } as FunctionTool,

    store_articles: {
      name: 'store_articles',
      description: 'Store news articles in the vector database for later retrieval',
      parameters: zodToJsonSchema(StoreArticlesSchema) as any,
      invoke: async (runContext: RunContext<VerificationContext>, input: string): Promise<{ success: boolean; stored: number }> => {
        try {
          const context = runContext?.context;
          const args = StoreArticlesSchema.parse(JSON.parse(input));
          await detector.storeNewsArticles(args.articles);
          if (context?.requestId) {
            console.log(`💾 Stored ${args.articles.length} articles for request: ${context.requestId}`);
          }
          return { success: true, stored: args.articles.length };
        } catch (error: any) {
          console.error('❌ Error in store_articles tool:', error);
          throw new Error(`Failed to store articles: ${error?.message || 'Unknown error'}`);
        }
      },
      strict: true,
      type: 'function' as const,
    } as FunctionTool,

    retrieve_evidence: {
      name: 'retrieve_evidence',
      description: 'Retrieve relevant evidence documents from the vector database for a claim',
      parameters: zodToJsonSchema(RetrieveEvidenceSchema) as any,
      invoke: async (runContext: RunContext<VerificationContext>, input: string): Promise<Document[]> => {
        try {
          const context = runContext?.context;
          const args = RetrieveEvidenceSchema.parse(JSON.parse(input));
          const evidence = await detector.findRelevantEvidence(args.claim, args.k || 10);
          if (context?.requestId) {
            console.log(`🔎 Retrieved ${evidence.length} evidence docs for request: ${context.requestId}`);
          }
          return evidence;
        } catch (error: any) {
          console.error('❌ Error in retrieve_evidence tool:', error);
          throw new Error(`Failed to retrieve evidence: ${error?.message || 'Unknown error'}`);
        }
      },
      strict: true,
      type: 'function' as const,
    } as FunctionTool,
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;

