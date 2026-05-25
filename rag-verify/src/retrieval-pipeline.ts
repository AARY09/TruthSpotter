import { Document } from '@langchain/core/documents';
import type { QdrantVectorStore } from '@langchain/qdrant';
import type { NewsArticlePayload } from './evidence-retrieval';
import {
  articlesToDocuments,
  dedupeDocumentsByLink,
  extractKeywordTokens,
  formatArticleForEmbedding,
  MAX_ARTICLES_PER_NEWS_QUERY,
  MAX_ARTICLES_TO_INDEX,
  MAX_EVIDENCE_RESULTS,
  MAX_SEARCH_QUERIES,
  rankEvidenceCandidates,
} from './evidence-retrieval';
import type { OptimizedSearchPlan } from './query-optimizer';

export interface ClaimAnalysisContext {
  claim: string;
  extractedClaims: string[];
  keywords: string[];
  context: string;
  searchQueries: string[];
  searchPlan: OptimizedSearchPlan;
}

export interface FetchNewsFn {
  (query: string): Promise<NewsArticlePayload[]>;
}

export interface StoreArticlesFn {
  (articles: NewsArticlePayload[]): Promise<void | boolean>;
}

/** Fetch news for optimized queries only; cap total articles */
export async function fetchNewsForPlan(
  plan: OptimizedSearchPlan,
  fetchNews: FetchNewsFn
): Promise<NewsArticlePayload[]> {
  const queries = plan.allQueries.slice(0, MAX_SEARCH_QUERIES);
  const seenLinks = new Set<string>();
  const collected: NewsArticlePayload[] = [];

  for (const query of queries) {
    if (collected.length >= MAX_ARTICLES_TO_INDEX) break;

    const articles = await fetchNews(query);
    for (const article of articles) {
      if (collected.length >= MAX_ARTICLES_TO_INDEX) break;
      const link = article.link?.toLowerCase().trim();
      if (!link || !link.startsWith('http') || seenLinks.has(link)) continue;
      if (!article.title && !article.snippet) continue;
      seenLinks.add(link);
      collected.push(article);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return collected.slice(0, MAX_ARTICLES_TO_INDEX);
}

/** Index articles with soft failure — verification can continue without Qdrant */
export async function indexArticlesSafe(
  articles: NewsArticlePayload[],
  storeArticles: StoreArticlesFn
): Promise<boolean> {
  if (articles.length === 0) return true;
  try {
    await storeArticles(articles);
    return true;
  } catch (error) {
    console.error('❌ Indexing failed (using in-memory evidence only):', error);
    return false;
  }
}

/** Minimal vector retrieval — one primary query to limit HF embedding calls */
export async function retrieveEvidence(
  plan: OptimizedSearchPlan,
  vectorStore: QdrantVectorStore | null,
  freshArticles: NewsArticlePayload[],
  limit: number = MAX_EVIDENCE_RESULTS
): Promise<Document[]> {
  const keywords = extractKeywordTokens(plan.primaryQuery, plan.claimKeywords);
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
      semanticScore: 0.9,
    });
  }

  if (vectorStore && freshArticles.length < limit) {
    try {
      const primary = plan.primaryQuery;
      const mmrDocs = await vectorStore.maxMarginalRelevanceSearch(primary, {
        k: Math.min(limit, 8),
        fetchK: 12,
        lambda: 0.7,
      });
      for (const doc of mmrDocs) {
        candidates.push({ doc, semanticScore: 0.82 });
      }

      const scored = await vectorStore.similaritySearchWithScore(primary, 6);
      for (const [doc, score] of scored) {
        candidates.push({ doc, semanticScore: score });
      }
    } catch (error) {
      console.error('❌ Vector retrieval failed:', error);
    }
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

  const ranked = rankEvidenceCandidates(Array.from(merged.values()), keywords, {
    minCombinedScore: 0.42,
    limit,
  });

  console.log(
    `🔎 Evidence: ${ranked.length} relevant (${freshArticles.length} fresh, ${candidates.length} candidates)`
  );
  return ranked;
}

export function freshArticlesToDocuments(articles: NewsArticlePayload[]): Document[] {
  return dedupeDocumentsByLink(articlesToDocuments(articles));
}
