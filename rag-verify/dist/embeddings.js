"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HuggingFaceEmbeddings = exports.HF_EMBEDDING_DIMENSION = exports.HF_EMBED_MODEL = void 0;
exports.requireHuggingfaceApiKey = requireHuggingfaceApiKey;
exports.generateEmbedding = generateEmbedding;
const embeddings_1 = require("@langchain/core/embeddings");
const token_monitor_1 = require("./token-monitor");
exports.HF_EMBED_MODEL = process.env.HF_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
/** all-MiniLM-L6-v2 and bge-small-en-v1.5 use 384 dimensions */
exports.HF_EMBEDDING_DIMENSION = 384;
function requireHuggingfaceApiKey() {
    return process.env.HUGGINGFACE_API_KEY || 'local';
}
let extractorPromise = null;
async function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
            return pipeline('feature-extraction', exports.HF_EMBED_MODEL);
        })();
    }
    return extractorPromise;
}
async function generateEmbedding(text) {
    const input = text.trim().slice(0, 2000);
    const extractor = await getExtractor();
    const output = await extractor(input, { pooling: 'mean', normalize: true });
    (0, token_monitor_1.recordHuggingFaceUsage)({ operation: 'featureExtraction', text: input });
    return Array.from(output.data);
}
/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
class HuggingFaceEmbeddings extends embeddings_1.Embeddings {
    constructor() {
        super({});
    }
    async embedDocuments(documents) {
        const results = [];
        for (const doc of documents) {
            results.push(await generateEmbedding(doc));
        }
        return results;
    }
    async embedQuery(document) {
        return generateEmbedding(document);
    }
}
exports.HuggingFaceEmbeddings = HuggingFaceEmbeddings;
//# sourceMappingURL=embeddings.js.map