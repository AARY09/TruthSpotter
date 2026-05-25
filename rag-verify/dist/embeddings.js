"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HuggingFaceEmbeddings = exports.HF_EMBEDDING_DIMENSION = exports.HF_EMBED_MODEL = void 0;
exports.requireHuggingfaceApiKey = requireHuggingfaceApiKey;
exports.generateEmbedding = generateEmbedding;
const inference_1 = require("@huggingface/inference");
const embeddings_1 = require("@langchain/core/embeddings");
exports.HF_EMBED_MODEL = process.env.HF_EMBED_MODEL ?? 'BAAI/bge-small-en-v1.5';
/** bge-small-en-v1.5 and all-MiniLM-L6-v2 use 384 dimensions */
exports.HF_EMBEDDING_DIMENSION = 384;
const hf = new inference_1.HfInference(process.env.HUGGINGFACE_API_KEY);
function requireHuggingfaceApiKey() {
    const key = process.env.HUGGINGFACE_API_KEY;
    if (!key) {
        throw new Error('HUGGINGFACE_API_KEY is required');
    }
    return key;
}
function toFlatVector(result) {
    if (result.length === 0) {
        throw new Error('Empty embedding response from Hugging Face');
    }
    if (typeof result[0] === 'number') {
        return result;
    }
    const rows = result;
    if (rows.length === 1) {
        return rows[0];
    }
    const dim = rows[0].length;
    return rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
}
function isRetryableEmbedError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = error?.httpResponse?.status;
    return status === 504 || status === 503 || status === 429 || /timeout|rate|503|504/i.test(msg);
}
async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function generateEmbedding(text) {
    requireHuggingfaceApiKey();
    const input = text.trim().slice(0, 2000);
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const result = await hf.featureExtraction({
                model: exports.HF_EMBED_MODEL,
                inputs: input,
            });
            return toFlatVector(result);
        }
        catch (error) {
            if (attempt >= maxAttempts - 1 || !isRetryableEmbedError(error))
                throw error;
            await sleep(600 * (attempt + 1));
        }
    }
    throw new Error('Embedding failed after retries');
}
/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
class HuggingFaceEmbeddings extends embeddings_1.Embeddings {
    constructor() {
        super({});
    }
    async embedDocuments(documents) {
        const results = [];
        for (let i = 0; i < documents.length; i++) {
            results.push(await generateEmbedding(documents[i]));
            if (i < documents.length - 1)
                await sleep(350);
        }
        return results;
    }
    async embedQuery(document) {
        return generateEmbedding(document);
    }
}
exports.HuggingFaceEmbeddings = HuggingFaceEmbeddings;
//# sourceMappingURL=embeddings.js.map