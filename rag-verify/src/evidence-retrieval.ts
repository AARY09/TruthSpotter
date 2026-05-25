import { Document } from '@langchain/core/documents';

export interface NewsArticlePayload {
  title: string;
  snippet: string;
  link: string;
  date: string;
  source?: string;
}

export interface EvidenceQueryContext {
  claim: string;
  extractedClaims: string[];
  keywords: string[];
  context: string;
  searchQueries?: string[];
}

export interface RankedEvidence {
  doc: Document;
  semanticScore: number;
  combinedScore: number;
}

/** Max articles to fetch + embed per verification (override via MAX_ARTICLES env) */
export const MAX_ARTICLES_TO_INDEX = Math.min(
  Math.max(parseInt(process.env.MAX_ARTICLES ?? '12', 10) || 12, 1),
  20
);

/** Google News search queries per claim (primary + optional fact-check) */
export const MAX_SEARCH_QUERIES = Math.min(
  Math.max(parseInt(process.env.MAX_SEARCH_QUERIES ?? '2', 10) || 2, 1),
  3
);

/** Per-query SerpAPI result cap */
export const MAX_ARTICLES_PER_NEWS_QUERY = Math.max(
  4,
  Math.ceil(MAX_ARTICLES_TO_INDEX / MAX_SEARCH_QUERIES)
);

/** Evidence documents passed to the fact-checker */
export const MAX_EVIDENCE_RESULTS = Math.min(
  Math.max(parseInt(process.env.MAX_EVIDENCE_RESULTS ?? '8', 10) || 8, 3),
  12
);

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'been', 'being', 'from', 'have', 'that', 'their',
  'there', 'these', 'they', 'this', 'those', 'were', 'what', 'when', 'where',
  'which', 'with', 'would', 'your',
]);

/** SerpAPI often returns source as an object ({ name, icon }) instead of a string */
export function toTextField(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => toTextField(v)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['name', 'title', 'source', 'text', 'label']) {
      const text = toTextField(obj[key]);
      if (text) return text;
    }
  }
  return '';
}

export function sanitizeNewsArticle(raw: Record<string, unknown>): NewsArticlePayload {
  const sourceRaw = raw.source;
  return {
    title: toTextField(raw.title) || 'Untitled',
    snippet: toTextField(raw.snippet) || toTextField(raw.description) || '',
    link: toTextField(raw.link) || toTextField(raw.url) || '',
    date: toTextField(raw.date) || toTextField(raw.published_at) || '',
    source: toTextField(sourceRaw) || 'Unknown',
  };
}

export function formatArticleForEmbedding(article: NewsArticlePayload): string {
  const title = toTextField(article.title) || 'Untitled';
  const snippet = toTextField(article.snippet) || '';
  const source = toTextField(article.source) || 'Unknown';
  const date = toTextField(article.date) || 'Unknown date';
  return [
    `Headline: ${title}`,
    `Source: ${source}`,
    `Date: ${date}`,
    `Summary: ${snippet}`,
  ].join('\n');
}

export function articlesToDocuments(articles: NewsArticlePayload[]): Document[] {
  return articles.map((article) =>
    new Document({
      pageContent: formatArticleForEmbedding(article),
      metadata: {
        title: toTextField(article.title) || 'Untitled',
        link: toTextField(article.link),
        date: toTextField(article.date),
        source: toTextField(article.source) || 'Unknown',
        type: 'news_article',
      },
    })
  );
}

export function extractKeywordTokens(claim: string, extra: string[] = []): string[] {
  const fromClaim = claim
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));

  const fromExtra = extra
    .flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/g))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  return Array.from(new Set([...fromClaim, ...fromExtra])).slice(0, 30);
}

export function computeKeywordCoverage(keywords: string[], text: string): number {
  if (!keywords.length) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) hits += 1;
  }
  return hits / keywords.length;
}

export function computeRecencyWeight(dateStr: string | undefined): number {
  if (!dateStr) return 0.35;
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return 0.35;
  const ageDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.9;
  if (ageDays <= 30) return 0.75;
  if (ageDays <= 180) return 0.55;
  return 0.35;
}

export function normalizeLink(url: string | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const normalized = url.toLowerCase().trim();
    const withoutProtocol = normalized.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return withoutProtocol.replace(/\/$/, '').split('?')[0].split('#')[0] || null;
  } catch {
    return url.toLowerCase().trim();
  }
}

export function dedupeDocumentsByLink(docs: Document[]): Document[] {
  const seen = new Set<string>();
  const out: Document[] = [];
  for (const doc of docs) {
    const meta = doc.metadata as Record<string, string | undefined>;
    const key =
      normalizeLink(meta.link) ||
      `${meta.title ?? ''}::${doc.pageContent.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doc);
  }
  return out;
}

/** Vector search uses optimized queries only (avoids many HF embed calls) */
export function buildRetrievalQueries(
  _claim: string,
  analysis: EvidenceQueryContext
): string[] {
  const fromPlan = analysis.searchQueries?.filter((q) => q.trim().length > 4) ?? [];
  if (fromPlan.length > 0) return fromPlan.slice(0, MAX_SEARCH_QUERIES);
  return [_claim.trim()].filter(Boolean);
}

export function rankEvidenceCandidates(
  candidates: Array<{ doc: Document; semanticScore: number }>,
  keywords: string[],
  options?: { minCombinedScore?: number; limit?: number }
): Document[] {
  const minCombined = options?.minCombinedScore ?? 0.38;
  const limit = options?.limit ?? 12;

  const byLink = new Map<string, RankedEvidence>();

  for (const { doc, semanticScore } of candidates) {
    const meta = doc.metadata as Record<string, string | undefined>;
    const text = `${meta.title ?? ''} ${doc.pageContent}`;
    const keywordScore = computeKeywordCoverage(keywords, text);
    const recencyWeight = computeRecencyWeight(meta.date ?? meta.published_at);
    const normalizedSemantic = Math.min(1, Math.max(0, semanticScore));
    const combinedScore =
      normalizedSemantic * 0.55 + keywordScore * 0.3 + recencyWeight * 0.15;

    if (combinedScore < minCombined) continue;

    const linkKey =
      normalizeLink(meta.link) ||
      `${meta.title ?? ''}::${doc.pageContent.slice(0, 80)}`;

    const existing = byLink.get(linkKey);
    if (!existing || combinedScore > existing.combinedScore) {
      byLink.set(linkKey, { doc, semanticScore: normalizedSemantic, combinedScore });
    }
  }

  return Array.from(byLink.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .map((r) => r.doc);
}
