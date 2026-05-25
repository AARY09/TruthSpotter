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
  Math.max(parseInt(process.env.MAX_ARTICLES ?? '20', 10) || 20, 1),
  20
);

/** Per Google News query — keeps 3 queries under the global cap */
export const MAX_ARTICLES_PER_NEWS_QUERY = Math.max(
  3,
  Math.ceil(MAX_ARTICLES_TO_INDEX / 3)
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

export function buildRetrievalQueries(claim: string, analysis: EvidenceQueryContext): string[] {
  const queries = new Set<string>();
  const context = analysis.context?.trim();

  queries.add(claim.trim());
  if (context && context.length > 10) {
    queries.add(`${claim.trim()} — ${context}`);
  }

  for (const sub of analysis.extractedClaims.slice(0, 3)) {
    const s = sub.trim();
    if (s.length > 12) queries.add(s);
  }

  const kw = analysis.keywords.filter(Boolean).slice(0, 6).join(' ');
  if (kw.length > 8) queries.add(kw);

  for (const sq of analysis.searchQueries ?? []) {
    const q = sq.trim();
    if (q.length > 8) queries.add(q);
  }

  const factCheck = `${claim.split(' ').slice(0, 12).join(' ')} fact check`.trim();
  queries.add(factCheck);

  return Array.from(queries).slice(0, 6);
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
