// Type declarations for Qdrant modules

declare module '@qdrant/js-client-rest' {
  export interface QdrantClientConfig {
    url: string;
    apiKey?: string;
  }
  
  export interface Collection {
    name: string;
  }
  
  export interface CollectionsList {
    collections: Collection[];
  }
  
  export class QdrantClient {
    constructor(config: QdrantClientConfig);
    
    getCollections(): Promise<CollectionsList>;
    getCollection(name: string): Promise<{
      config?: { params?: { vectors?: { size: number } | Record<string, { size: number }> } };
    }>;
    deleteCollection(name: string): Promise<void>;
    createCollection(name: string, config: {
      vectors: {
        size: number;
        distance: 'Cosine' | 'Euclidean' | 'Dot';
      };
    }): Promise<void>;
  }
}

