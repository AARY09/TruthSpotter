// Type declarations for LangChain modules

declare module '@langchain/groq' {
  export class ChatGroq {
    constructor(config: Record<string, unknown>);
    invoke(messages: unknown[], options?: Record<string, unknown>): Promise<{ content: unknown }>;
    withConfig(config: Record<string, unknown>): ChatGroq;
  }
}

declare module '@langchain/qdrant' {
  import { Embeddings } from '@langchain/core/embeddings';
  import { VectorStore } from '@langchain/core/vectorstores';
  import { Document } from '@langchain/core/documents';

  export class QdrantVectorStore extends VectorStore {
    constructor(embeddings: Embeddings, config: {
      client: unknown;
      collectionName: string;
    });

    addDocuments(documents: Document[]): Promise<void>;
    similaritySearch(query: string, k?: number): Promise<Document[]>;
    similaritySearchWithScore(query: string, k?: number): Promise<[Document, number][]>;
    maxMarginalRelevanceSearch(
      query: string,
      options: { k: number; fetchK?: number; lambda?: number }
    ): Promise<Document[]>;
  }
}

declare module '@langchain/core/documents' {
  export class Document {
    pageContent: string;
    metadata: Record<string, unknown>;

    constructor(config: {
      pageContent: string;
      metadata?: Record<string, unknown>;
    });
  }
}

declare module 'langchain/text_splitter' {
  export class RecursiveCharacterTextSplitter {
    constructor(config?: {
      chunkSize?: number;
      chunkOverlap?: number;
    });

    splitText(text: string): Promise<string[]>;
  }
}
