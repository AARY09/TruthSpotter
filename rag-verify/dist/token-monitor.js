"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokensFromText = estimateTokensFromText;
exports.startTokenSession = startTokenSession;
exports.endTokenSession = endTokenSession;
exports.getSessionSnapshot = getSessionSnapshot;
exports.runWithTokenSession = runWithTokenSession;
exports.recordGroqUsage = recordGroqUsage;
exports.recordHuggingFaceUsage = recordHuggingFaceUsage;
exports.getLifetimeUsage = getLifetimeUsage;
exports.getRecentTokenEvents = getRecentTokenEvents;
exports.extractGroqTokenUsage = extractGroqTokenUsage;
const async_hooks_1 = require("async_hooks");
const emptyUsage = () => ({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
});
function emptySession() {
    return {
        groq: emptyUsage(),
        huggingface: emptyUsage(),
        events: [],
    };
}
function snapshotFrom(state) {
    return {
        groq: { ...state.groq },
        huggingface: { ...state.huggingface },
        totalTokens: state.groq.totalTokens + state.huggingface.totalTokens,
        totalCalls: state.groq.calls + state.huggingface.calls,
    };
}
const als = new async_hooks_1.AsyncLocalStorage();
const sessions = new Map();
const lifetime = emptySession();
const recentEvents = [];
const MAX_RECENT_EVENTS = 200;
/** ~4 chars per token — used when a provider does not return usage */
function estimateTokensFromText(text) {
    if (!text)
        return 0;
    return Math.max(1, Math.ceil(text.length / 4));
}
function addUsage(target, prompt, completion) {
    target.promptTokens += prompt;
    target.completionTokens += completion;
    target.totalTokens += prompt + completion;
    target.calls += 1;
}
function pushEvent(event) {
    recentEvents.push(event);
    if (recentEvents.length > MAX_RECENT_EVENTS)
        recentEvents.shift();
    const sessionId = als.getStore()?.sessionId;
    if (sessionId) {
        const session = sessions.get(sessionId);
        session?.events.push(event);
    }
}
function startTokenSession(sessionId) {
    sessions.set(sessionId, emptySession());
}
function endTokenSession(sessionId) {
    const state = sessions.get(sessionId) ?? emptySession();
    const snap = snapshotFrom(state);
    sessions.delete(sessionId);
    return snap;
}
function getSessionSnapshot(sessionId) {
    const id = sessionId ?? als.getStore()?.sessionId;
    if (!id)
        return snapshotFrom(emptySession());
    return snapshotFrom(sessions.get(id) ?? emptySession());
}
async function runWithTokenSession(sessionId, fn) {
    startTokenSession(sessionId);
    try {
        const result = await als.run({ sessionId }, fn);
        return { result, usage: getSessionSnapshot(sessionId) };
    }
    finally {
        endTokenSession(sessionId);
    }
}
function recordGroqUsage(args) {
    const prompt = args.promptTokens ?? estimateTokensFromText(args.promptText ?? '');
    const completion = args.completionTokens ?? estimateTokensFromText(args.completionText ?? '');
    addUsage(lifetime.groq, prompt, completion);
    const sessionId = als.getStore()?.sessionId;
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (session)
            addUsage(session.groq, prompt, completion);
    }
    const event = {
        at: new Date().toISOString(),
        provider: 'groq',
        operation: args.operation,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
    };
    pushEvent(event);
    console.log(`📊 Groq tokens [${args.operation}]: +${prompt + completion} (in ${prompt} / out ${completion})`);
}
function recordHuggingFaceUsage(args) {
    const tokens = args.estimatedTokens ?? estimateTokensFromText(args.text ?? '');
    addUsage(lifetime.huggingface, tokens, 0);
    const sessionId = als.getStore()?.sessionId;
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (session)
            addUsage(session.huggingface, tokens, 0);
    }
    const event = {
        at: new Date().toISOString(),
        provider: 'huggingface',
        operation: args.operation,
        promptTokens: tokens,
        completionTokens: 0,
        totalTokens: tokens,
    };
    pushEvent(event);
}
function getLifetimeUsage() {
    return snapshotFrom(lifetime);
}
function getRecentTokenEvents(limit = 50) {
    return recentEvents.slice(-limit);
}
function extractGroqTokenUsage(response) {
    const r = response;
    const fromUsageMeta = r?.usage_metadata;
    if (fromUsageMeta?.input_tokens != null || fromUsageMeta?.output_tokens != null) {
        return {
            promptTokens: fromUsageMeta.input_tokens ?? 0,
            completionTokens: fromUsageMeta.output_tokens ?? 0,
        };
    }
    const tokenUsage = r?.response_metadata?.tokenUsage;
    if (tokenUsage?.promptTokens != null || tokenUsage?.completionTokens != null) {
        return {
            promptTokens: tokenUsage.promptTokens ?? 0,
            completionTokens: tokenUsage.completionTokens ?? 0,
        };
    }
    const usage = r?.response_metadata?.usage;
    if (usage?.prompt_tokens != null || usage?.completion_tokens != null) {
        return {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
        };
    }
    return {};
}
//# sourceMappingURL=token-monitor.js.map