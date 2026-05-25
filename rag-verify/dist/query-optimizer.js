"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_QUERY_WORDS = void 0;
exports.enforceQueryWordLimit = enforceQueryWordLimit;
exports.optimizeSearchQueries = optimizeSearchQueries;
const groq_llm_1 = require("./groq-llm");
exports.MAX_QUERY_WORDS = 15;
function enforceQueryWordLimit(query, maxWords = exports.MAX_QUERY_WORDS) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ');
}
function extractClaimKeywords(claim) {
    const stop = new Set([
        'about', 'after', 'also', 'been', 'being', 'from', 'have', 'that', 'their',
        'there', 'these', 'they', 'this', 'those', 'were', 'what', 'when', 'where',
        'which', 'with', 'would', 'your', 'does', 'did', 'happen', 'really', 'true',
    ]);
    return Array.from(new Set(claim
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((t) => t.length >= 3 && !stop.has(t)))).slice(0, 12);
}
function fallbackPlan(claim) {
    const trimmed = claim.trim().replace(/\?+$/, '');
    const words = trimmed.split(/\s+/).filter(Boolean);
    const hasTimeHint = /\b(today|yesterday|recent|latest|now|202\d)\b/i.test(trimmed);
    const temporal = hasTimeHint ? '' : ' latest news';
    const primary = enforceQueryWordLimit(words.length > 10 ? `${words.slice(0, 10).join(' ')}${temporal}` : `${trimmed}${temporal}`);
    const factCheck = enforceQueryWordLimit(`${words.slice(0, 8).join(' ')} fact check verification`);
    const secondary = factCheck !== primary ? [factCheck] : [];
    return {
        primaryQuery: primary,
        secondaryQueries: secondary,
        allQueries: [primary, ...secondary],
        claimKeywords: extractClaimKeywords(claim),
    };
}
function parseOptimizerJson(raw, claim) {
    try {
        const parsed = JSON.parse(raw);
        const primary = enforceQueryWordLimit(typeof parsed.primaryQuery === 'string' ? parsed.primaryQuery : '');
        if (!primary || primary.length < 4)
            return null;
        const secondary = (Array.isArray(parsed.secondaryQueries) ? parsed.secondaryQueries : [])
            .filter((q) => typeof q === 'string' && q.trim().length > 4)
            .map((q) => enforceQueryWordLimit(q))
            .filter((q) => q !== primary)
            .slice(0, 1);
        const allQueries = Array.from(new Set([primary, ...secondary]));
        return {
            primaryQuery: primary,
            secondaryQueries: secondary,
            allQueries,
            claimKeywords: extractClaimKeywords(claim),
        };
    }
    catch {
        return null;
    }
}
/**
 * Rewrite ambiguous claims into concise Google News queries via Groq.
 * Does not invent entities — prompt enforces claim-only grounding.
 */
async function optimizeSearchQueries(claim) {
    const prompt = `Rewrite this user claim into Google News search queries.

Claim: "${claim}"

Rules:
- Respond with JSON only: {"primaryQuery":"...","secondaryQueries":["..."]}
- primaryQuery: one concise phrase, maximum 15 words, optimized for Google News
- secondaryQueries: at most ONE extra query (e.g. fact-check angle), max 15 words each
- Add words like "latest", "recent", or "today" ONLY if the claim implies a current/recent event
- Use ONLY people, places, dates, and events explicitly stated in the claim
- Do NOT add locations, dates, causes, or names that are not in the claim
- Turn vague questions into concrete news search phrases

Example input: "did delhi blast happen"
Example output: {"primaryQuery":"Recent Delhi bomb blast latest news","secondaryQueries":["Delhi blast fact check"]}

JSON:`;
    try {
        const response = await (0, groq_llm_1.groqCompleteWithRetry)(prompt, {
            maxTokens: 200,
            temperature: 0.1,
            requireJson: true,
            retries: 1,
        });
        const plan = parseOptimizerJson(response, claim);
        if (plan) {
            console.log(`🔍 Optimized queries: ${plan.allQueries.join(' | ')}`);
            return plan;
        }
    }
    catch (error) {
        console.warn('⚠️ Query optimization failed, using fallback:', error);
    }
    const fallback = fallbackPlan(claim);
    console.log(`🔍 Fallback queries: ${fallback.allQueries.join(' | ')}`);
    return fallback;
}
//# sourceMappingURL=query-optimizer.js.map