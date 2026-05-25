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
async function generateEmbedding(text) {
    requireHuggingfaceApiKey();
    const result = await hf.featureExtraction({
        model: exports.HF_EMBED_MODEL,
        inputs: text,
    });
    return toFlatVector(result);
}
/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
class HuggingFaceEmbeddings extends embeddings_1.Embeddings {
    constructor() {
        super({});
    }
    async embedDocuments(documents) {
        const results = [];
        const batchSize = 3;
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const vectors = await Promise.all(batch.map((doc) => generateEmbedding(doc)));
            results.push(...vectors);
            if (i + batchSize < documents.length) {
                await new Promise((r) => setTimeout(r, 250));
            }
        }
        return results;
    }
    async embedQuery(document) {
        return generateEmbedding(document);
    }
}
exports.HuggingFaceEmbeddings = HuggingFaceEmbeddings;
//# sourceMappingURL=embeddings.js.map