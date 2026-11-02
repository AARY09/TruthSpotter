"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const crypto_1 = __importDefault(require("crypto"));
// Configuration constants
const REDIS_URL = process.env.REDIS_URL;
const DEFAULT_TTL_SECONDS = parseInt(process.env.REDIS_CACHE_TTL_SECONDS || '86400', 10); // 24 hours default
const KEY_PREFIX = 'truthspotter:';
class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.isExplicitlyDisabled = false;
        this.lastError = null;
        // In-memory fallback sets and cache when Redis is unavailable
        this.memoryCache = new Map();
        this.memorySets = new Map();
        this.initialize();
    }
    initialize() {
        if (!REDIS_URL && !process.env.REDIS_HOST) {
            console.log('ℹ️ REDIS_URL not configured. Operating in in-memory fallback mode.');
            this.isExplicitlyDisabled = true;
            return;
        }
        try {
            const options = {
                retryStrategy: (times) => {
                    if (times > 5) {
                        console.warn('⚠️ Redis max reconnect attempts reached. Using in-memory fallback.');
                        return null; // Stop retrying
                    }
                    const delay = Math.min(times * 500, 3000);
                    return delay;
                },
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false, // Don't hang requests if Redis is temporarily offline
                lazyConnect: true,
            };
            if (REDIS_URL) {
                this.client = new ioredis_1.default(REDIS_URL, options);
            }
            else {
                this.client = new ioredis_1.default({
                    host: process.env.REDIS_HOST || '127.0.0.1',
                    port: parseInt(process.env.REDIS_PORT || '6379', 10),
                    password: process.env.REDIS_PASSWORD || undefined,
                    ...options,
                });
            }
            this.client.on('connect', () => {
                this.isConnected = true;
                this.lastError = null;
                console.log('✅ Connected to Redis successfully');
            });
            this.client.on('ready', () => {
                this.isConnected = true;
            });
            this.client.on('error', (err) => {
                this.isConnected = false;
                this.lastError = err.message;
                console.warn(`⚠️ Redis error (${err.message}). Using in-memory fallback.`);
            });
            this.client.on('close', () => {
                this.isConnected = false;
            });
            // Initiate connection asynchronously
            this.client.connect().catch((err) => {
                this.isConnected = false;
                this.lastError = err.message;
                console.warn(`⚠️ Redis initial connection failed: ${err.message}. Running in fallback mode.`);
            });
        }
        catch (err) {
            this.isConnected = false;
            this.lastError = err.message;
            console.warn(`⚠️ Failed to initialize Redis client: ${err.message}`);
        }
    }
    /**
     * Check if Redis is actively connected and ready
     */
    isAvailable() {
        return this.isConnected && this.client !== null;
    }
    /**
     * Get raw ioredis instance (e.g. for rate-limit-redis)
     */
    getClient() {
        return this.client;
    }
    /**
     * Generate a normalized hash key for claim text
     */
    hashClaim(claim) {
        const normalized = claim.trim().toLowerCase().replace(/\s+/g, ' ');
        return crypto_1.default.createHash('sha256').update(normalized).digest('hex');
    }
    /**
     * Get cached claim verification result
     */
    async getCachedVerification(claim, type = 'standard') {
        const key = `${KEY_PREFIX}verify:${type}:${this.hashClaim(claim)}`;
        if (this.isAvailable()) {
            try {
                const raw = await this.client.get(key);
                if (raw) {
                    return JSON.parse(raw);
                }
            }
            catch (err) {
                console.warn('⚠️ Redis getCachedVerification error, falling back to memory:', err);
            }
        }
        // In-memory fallback
        const mem = this.memoryCache.get(key);
        if (mem) {
            if (Date.now() < mem.expiresAt) {
                return mem.data;
            }
            this.memoryCache.delete(key);
        }
        return null;
    }
    /**
     * Store claim verification result in cache with TTL
     */
    async setCachedVerification(claim, result, type = 'standard', ttlSeconds = DEFAULT_TTL_SECONDS) {
        const key = `${KEY_PREFIX}verify:${type}:${this.hashClaim(claim)}`;
        const serialized = JSON.stringify(result);
        if (this.isAvailable()) {
            try {
                await this.client.setex(key, ttlSeconds, serialized);
                return;
            }
            catch (err) {
                console.warn('⚠️ Redis setCachedVerification error, writing to memory fallback:', err);
            }
        }
        // In-memory fallback
        this.memoryCache.set(key, {
            data: result,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }
    /**
     * Check if a URL has already been processed (for RumorWatcher deduplication)
     */
    async isUrlProcessed(url) {
        const setKey = `${KEY_PREFIX}processed_urls`;
        if (this.isAvailable()) {
            try {
                const member = await this.client.sismember(setKey, url);
                return member === 1;
            }
            catch (err) {
                console.warn('⚠️ Redis isUrlProcessed error, falling back to memory:', err);
            }
        }
        const memSet = this.memorySets.get(setKey);
        return memSet ? memSet.has(url) : false;
    }
    /**
     * Mark a URL as processed
     */
    async markUrlProcessed(url) {
        const setKey = `${KEY_PREFIX}processed_urls`;
        if (this.isAvailable()) {
            try {
                await this.client.sadd(setKey, url);
                return;
            }
            catch (err) {
                console.warn('⚠️ Redis markUrlProcessed error, writing to memory fallback:', err);
            }
        }
        if (!this.memorySets.has(setKey)) {
            this.memorySets.set(setKey, new Set());
        }
        this.memorySets.get(setKey).add(url);
    }
    /**
     * Clear all processed URLs
     */
    async clearProcessedUrls() {
        const setKey = `${KEY_PREFIX}processed_urls`;
        if (this.isAvailable()) {
            try {
                await this.client.del(setKey);
            }
            catch (err) {
                console.warn('⚠️ Redis clearProcessedUrls error:', err);
            }
        }
        this.memorySets.delete(setKey);
    }
    /**
     * Clear all TruthSpotter verification cache keys
     */
    async clearCache() {
        let clearedCount = 0;
        if (this.isAvailable()) {
            try {
                const stream = this.client.scanStream({
                    match: `${KEY_PREFIX}*`,
                    count: 100,
                });
                const keysToDelete = [];
                for await (const resultKeys of stream) {
                    if (resultKeys.length) {
                        keysToDelete.push(...resultKeys);
                    }
                }
                if (keysToDelete.length > 0) {
                    clearedCount = await this.client.del(...keysToDelete);
                }
            }
            catch (err) {
                console.warn('⚠️ Redis clearCache error:', err);
            }
        }
        clearedCount += this.memoryCache.size;
        this.memoryCache.clear();
        this.memorySets.clear();
        return clearedCount;
    }
    /**
     * Get health and diagnostics about Redis connection
     */
    async getHealth() {
        if (this.isExplicitlyDisabled) {
            return {
                status: 'disabled',
                urlConfigured: false,
            };
        }
        if (!this.isAvailable()) {
            return {
                status: this.client ? 'connecting' : 'disconnected',
                urlConfigured: true,
                error: this.lastError || undefined,
            };
        }
        try {
            const start = Date.now();
            await this.client.ping();
            const pingMs = Date.now() - start;
            let keysCount;
            try {
                const info = await this.client.dbsize();
                keysCount = info;
            }
            catch {
                // dbsize might fail in some restricted environments, ignore
            }
            return {
                status: 'connected',
                urlConfigured: true,
                pingMs,
                keysCount,
            };
        }
        catch (err) {
            return {
                status: 'error',
                urlConfigured: true,
                error: err.message,
            };
        }
    }
}
exports.redisService = new RedisService();
//# sourceMappingURL=redis-client.js.map