"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ARTICLES_PER_NEWS_QUERY = exports.MAX_ARTICLES_TO_INDEX = void 0;
exports.toTextField = toTextField;
exports.sanitizeNewsArticle = sanitizeNewsArticle;
exports.formatArticleForEmbedding = formatArticleForEmbedding;
exports.articlesToDocuments = articlesToDocuments;
exports.extractKeywordTokens = extractKeywordTokens;
exports.computeKeywordCoverage = computeKeywordCoverage;
exports.computeRecencyWeight = computeRecencyWeight;
exports.normalizeLink = normalizeLink;
exports.dedupeDocumentsByLink = dedupeDocumentsByLink;
exports.buildRetrievalQueries = buildRetrievalQueries;
exports.rankEvidenceCandidates = rankEvidenceCandidates;
const documents_1 = require("@langchain/core/documents");
/** Max articles to fetch + embed per verification (override via MAX_ARTICLES env) */
exports.MAX_ARTICLES_TO_INDEX = Math.min(Math.max(parseInt(process.env.MAX_ARTICLES ?? '20', 10) || 20, 1), 20);
/** Per Google News query — keeps 3 queries under the global cap */
exports.MAX_ARTICLES_PER_NEWS_QUERY = Math.max(3, Math.ceil(exports.MAX_ARTICLES_TO_INDEX / 3));
const STOP_WORDS = new Set([
    'about', 'after', 'also', 'been', 'being', 'from', 'have', 'that', 'their',
    'there', 'these', 'they', 'this', 'those', 'were', 'what', 'when', 'where',
    'which', 'with', 'would', 'your',
]);
/** SerpAPI often returns source as an object ({ name, icon }) instead of a string */
function toTextField(value) {
    if (value == null)
        return '';
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value)) {
        return value.map((v) => toTextField(v)).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') {
        const obj = value;
        for (const key of ['name', 'title', 'source', 'text', 'label']) {
            const text = toTextField(obj[key]);
            if (text)
                return text;
        }
    }
    return '';
}
function sanitizeNewsArticle(raw) {
    const sourceRaw = raw.source;
    return {
        title: toTextField(raw.title) || 'Untitled',
        snippet: toTextField(raw.snippet) || toTextField(raw.description) || '',
        link: toTextField(raw.link) || toTextField(raw.url) || '',
        date: toTextField(raw.date) || toTextField(raw.published_at) || '',
        source: toTextField(sourceRaw) || 'Unknown',
    };
}
function formatArticleForEmbedding(article) {
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
function articlesToDocuments(articles) {
    return articles.map((article) => new documents_1.Document({
        pageContent: formatArticleForEmbedding(article),
        metadata: {
            title: toTextField(article.title) || 'Untitled',
            link: toTextField(article.link),
            date: toTextField(article.date),
            source: toTextField(article.source) || 'Unknown',
            type: 'news_article',
        },
    }));
}
function extractKeywordTokens(claim, extra = []) {
    const fromClaim = claim
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
    const fromExtra = extra
        .flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/g))
        .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
    return Array.from(new Set([...fromClaim, ...fromExtra])).slice(0, 30);
}
function computeKeywordCoverage(keywords, text) {
    if (!keywords.length)
        return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const keyword of keywords) {
        if (lower.includes(keyword))
            hits += 1;
    }
    return hits / keywords.length;
}
function computeRecencyWeight(dateStr) {
    if (!dateStr)
        return 0.35;
    const parsed = Date.parse(dateStr);
    if (Number.isNaN(parsed))
        return 0.35;
    const ageDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
    if (ageDays <= 2)
        return 1;
    if (ageDays <= 7)
        return 0.9;
    if (ageDays <= 30)
        return 0.75;
    if (ageDays <= 180)
        return 0.55;
    return 0.35;
}
function normalizeLink(url) {
    if (!url || typeof url !== 'string')
        return null;
    try {
        const normalized = url.toLowerCase().trim();
        const withoutProtocol = normalized.replace(/^https?:\/\//, '').replace(/^www\./, '');
        return withoutProtocol.replace(/\/$/, '').split('?')[0].split('#')[0] || null;
    }
    catch {
        return url.toLowerCase().trim();
    }
}
function dedupeDocumentsByLink(docs) {
    const seen = new Set();
    const out = [];
    for (const doc of docs) {
        const meta = doc.metadata;
        const key = normalizeLink(meta.link) ||
            `${meta.title ?? ''}::${doc.pageContent.slice(0, 120)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(doc);
    }
    return out;
}
function buildRetrievalQueries(claim, analysis) {
    const queries = new Set();
    const context = analysis.context?.trim();
    queries.add(claim.trim());
    if (context && context.length > 10) {
        queries.add(`${claim.trim()} — ${context}`);
    }
    for (const sub of analysis.extractedClaims.slice(0, 3)) {
        const s = sub.trim();
        if (s.length > 12)
            queries.add(s);
    }
    const kw = analysis.keywords.filter(Boolean).slice(0, 6).join(' ');
    if (kw.length > 8)
        queries.add(kw);
    for (const sq of analysis.searchQueries ?? []) {
        const q = sq.trim();
        if (q.length > 8)
            queries.add(q);
    }
    const factCheck = `${claim.split(' ').slice(0, 12).join(' ')} fact check`.trim();
    queries.add(factCheck);
    return Array.from(queries).slice(0, 6);
}
function rankEvidenceCandidates(candidates, keywords, options) {
    const minCombined = options?.minCombinedScore ?? 0.38;
    const limit = options?.limit ?? 12;
    const byLink = new Map();
    for (const { doc, semanticScore } of candidates) {
        const meta = doc.metadata;
        const text = `${meta.title ?? ''} ${doc.pageContent}`;
        const keywordScore = computeKeywordCoverage(keywords, text);
        const recencyWeight = computeRecencyWeight(meta.date ?? meta.published_at);
        const normalizedSemantic = Math.min(1, Math.max(0, semanticScore));
        const combinedScore = normalizedSemantic * 0.55 + keywordScore * 0.3 + recencyWeight * 0.15;
        if (combinedScore < minCombined)
            continue;
        const linkKey = normalizeLink(meta.link) ||
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
//# sourceMappingURL=evidence-retrieval.js.map