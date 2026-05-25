"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROQ_CHAT_MODEL = exports.GROQ_API_KEY = void 0;
exports.requireGroqApiKey = requireGroqApiKey;
exports.GROQ_API_KEY = process.env.GROQ_API_KEY;
exports.GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile';
function requireGroqApiKey() {
    if (!exports.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is required');
    }
    return exports.GROQ_API_KEY;
}
//# sourceMappingURL=groq-config.js.map