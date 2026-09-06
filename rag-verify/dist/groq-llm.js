"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatGroq = createChatGroq;
exports.groqComplete = groqComplete;
exports.groqCompleteWithRetry = groqCompleteWithRetry;
const groq_1 = require("@langchain/groq");
const messages_1 = require("@langchain/core/messages");
const groq_config_1 = require("./groq-config");
const token_monitor_1 = require("./token-monitor");
function createChatGroq(overrides) {
    return new groq_1.ChatGroq({
        apiKey: (0, groq_config_1.requireGroqApiKey)(),
        model: groq_config_1.GROQ_CHAT_MODEL,
        temperature: 0.1,
        maxRetries: 2,
        ...overrides,
    });
}
async function groqComplete(prompt, options) {
    const llm = createChatGroq({
        temperature: options?.temperature ?? 0.1,
        maxTokens: options?.maxTokens,
    });
    const response = await llm.invoke([new messages_1.HumanMessage(prompt)]);
    const content = response.content;
    let text;
    if (typeof content === 'string')
        text = content;
    else if (Array.isArray(content)) {
        text = content
            .map((part) => (typeof part === 'string' ? part : part.text ?? ''))
            .join('');
    }
    else {
        text = String(content ?? '');
    }
    const usage = (0, token_monitor_1.extractGroqTokenUsage)(response);
    (0, token_monitor_1.recordGroqUsage)({
        operation: options?.operation ?? 'groqComplete',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        promptText: prompt,
        completionText: text,
    });
    return text;
}
async function groqCompleteWithRetry(prompt, options) {
    const retries = options?.retries ?? 2;
    const requireJson = options?.requireJson ?? false;
    for (let i = 0; i <= retries; i++) {
        try {
            const text = await groqComplete(prompt, options);
            if (text && (!requireJson || text.includes('{')))
                return text;
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`⚠️ Groq retry ${i + 1}/${retries} failed: ${message}`);
        }
    }
    throw new Error('Groq model failed to return a valid response after retries.');
}
//# sourceMappingURL=groq-llm.js.map