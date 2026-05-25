import { Embeddings } from '@langchain/core/embeddings';
export declare const HF_EMBED_MODEL: string;
/** bge-small-en-v1.5 and all-MiniLM-L6-v2 use 384 dimensions */
export declare const HF_EMBEDDING_DIMENSION = 384;
export declare function requireHuggingfaceApiKey(): string;
export declare function generateEmbedding(text: string): Promise<number[]>;
/** LangChain adapter so QdrantVectorStore can call generateEmbedding internally */
export declare class HuggingFaceEmbeddings extends Embeddings {
    constructor();
    embedDocuments(documents: string[]): Promise<number[][]>;
    embedQuery(document: string): Promise<number[]>;
}
//# sourceMappingURL=embeddings.d.ts.map