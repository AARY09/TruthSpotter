import Redis from 'ioredis';
export interface RedisHealth {
    status: 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';
    urlConfigured: boolean;
    pingMs?: number;
    error?: string;
    keysCount?: number;
}
declare class RedisService {
    private client;
    private isConnected;
    private isExplicitlyDisabled;
    private lastError;
    private memoryCache;
    private memorySets;
    constructor();
    private initialize;
    /**
     * Check if Redis is actively connected and ready
     */
    isAvailable(): boolean;
    /**
     * Get raw ioredis instance (e.g. for rate-limit-redis)
     */
    getClient(): Redis | null;
    /**
     * Generate a normalized hash key for claim text
     */
    hashClaim(claim: string): string;
    /**
     * Get cached claim verification result
     */
    getCachedVerification<T = any>(claim: string, type?: 'standard' | 'agentic'): Promise<T | null>;
    /**
     * Store claim verification result in cache with TTL
     */
    setCachedVerification(claim: string, result: any, type?: 'standard' | 'agentic', ttlSeconds?: number): Promise<void>;
    /**
     * Check if a URL has already been processed (for RumorWatcher deduplication)
     */
    isUrlProcessed(url: string): Promise<boolean>;
    /**
     * Mark a URL as processed
     */
    markUrlProcessed(url: string): Promise<void>;
    /**
     * Clear all processed URLs
     */
    clearProcessedUrls(): Promise<void>;
    /**
     * Clear all TruthSpotter verification cache keys
     */
    clearCache(): Promise<number>;
    /**
     * Get health and diagnostics about Redis connection
     */
    getHealth(): Promise<RedisHealth>;
}
export declare const redisService: RedisService;
export {};
//# sourceMappingURL=redis-client.d.ts.map