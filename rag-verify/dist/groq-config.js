"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROQ_EMBEDDING_DIMENSION = exports.GROQ_OPENAI_BASE_URL = exports.GROQ_EMBED_MODEL = exports.GROQ_CHAT_MODEL = exports.GROQ_API_KEY = void 0;
exports.requireGroqApiKey = requireGroqApiKey;
exports.GROQ_API_KEY = process.env.GROQ_API_KEY;
exports.GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile';
exports.GROQ_EMBED_MODEL = process.env.GROQ_EMBED_MODEL ?? 'nomic-embed-text-v1.5';
exports.GROQ_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
/** nomic-embed-text-v1.5 on Groq uses 768 dimensions */
exports.GROQ_EMBEDDING_DIMENSION = 768;
function requireGroqApiKey() {
    if (!exports.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is required');
    }
    return exports.GROQ_API_KEY;
}
//# sourceMappingURL=groq-config.js.map