"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNewsForPlan = fetchNewsForPlan;
exports.indexArticlesSafe = indexArticlesSafe;
exports.retrieveEvidence = retrieveEvidence;
exports.freshArticlesToDocuments = freshArticlesToDocuments;
const documents_1 = require("@langchain/core/documents");
const evidence_retrieval_1 = require("./evidence-retrieval");
/** Fetch news for optimized queries only; cap total articles */
async function fetchNewsForPlan(plan, fetchNews) {
    const queries = plan.allQueries.slice(0, evidence_retrieval_1.MAX_SEARCH_QUERIES);
    const seenLinks = new Set();
    const collected = [];
    for (const query of queries) {
        if (collected.length >= evidence_retrieval_1.MAX_ARTICLES_TO_INDEX)
            break;
        const articles = await fetchNews(query);
        for (const article of articles) {
            if (collected.length >= evidence_retrieval_1.MAX_ARTICLES_TO_INDEX)
                break;
            const link = article.link?.toLowerCase().trim();
            if (!link || !link.startsWith('http') || seenLinks.has(link))
                continue;
            if (!article.title && !article.snippet)
                continue;
            seenLinks.add(link);
            collected.push(article);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    return collected.slice(0, evidence_retrieval_1.MAX_ARTICLES_TO_INDEX);
}
/** Index articles with soft failure — verification can continue without Qdrant */
async function indexArticlesSafe(articles, storeArticles) {
    if (articles.length === 0)
        return true;
    try {
        await storeArticles(articles);
        return true;
    }
    catch (error) {
        console.error('❌ Indexing failed (using in-memory evidence only):', error);
        return false;
    }
}
/** Minimal vector retrieval — one primary query to limit HF embedding calls */
async function retrieveEvidence(plan, vectorStore, freshArticles, limit = evidence_retrieval_1.MAX_EVIDENCE_RESULTS) {
    const keywords = (0, evidence_retrieval_1.extractKeywordTokens)(plan.primaryQuery, plan.claimKeywords);
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
        }
        catch (error) {
            console.error('❌ Vector retrieval failed:', error);
        }
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
    const ranked = (0, evidence_retrieval_1.rankEvidenceCandidates)(Array.from(merged.values()), keywords, {
        minCombinedScore: 0.42,
        limit,
    });
    console.log(`🔎 Evidence: ${ranked.length} relevant (${freshArticles.length} fresh, ${candidates.length} candidates)`);
    return ranked;
}
function freshArticlesToDocuments(articles) {
    return (0, evidence_retrieval_1.dedupeDocumentsByLink)((0, evidence_retrieval_1.articlesToDocuments)(articles));
}
//# sourceMappingURL=retrieval-pipeline.js.map