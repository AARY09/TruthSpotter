import express from 'express';
import cors from 'cors';
import { MisinformationDetector, VerificationResult } from './detector';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { AgentOrchestrator } from './agent-orchestrator';
import { getLifetimeUsage, getRecentTokenEvents } from './token-monitor';
import { redisService } from './redis-client';
import whatsappRouter from "./routes/whatsapp"; // adjust path if needed


console.log('🚀 Starting application...');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware — allow Vercel frontend + local dev
const corsOrigins = [
  'http://localhost:8080',
  'http://localhost:5173',
  'https://truth-spotter-ten.vercel.app',
  'https://truthspotter.vercel.app',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : []),
];

app.use(
  cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/', whatsappRouter);

console.log('✅ Middleware configured');

// Rate limiting with Redis store if available
const createRateLimiter = (windowMs: number, max: number, message: string, prefix: string) => {
  const client = redisService.getClient();
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    store: client
      ? new RedisStore({
          sendCommand: (...args: string[]) => (client as any).call(...args),
          prefix: `truthspotter:rl:${prefix}:`,
        })
      : undefined,
  });
};

const limiter = createRateLimiter(
  15 * 60 * 1000,
  100,
  'Too many requests from this IP, please try again later.',
  'general'
);
app.use(limiter);

const verifyLimiter = createRateLimiter(
  5 * 60 * 1000,
  10,
  'Too many verification requests, please try again later.',
  'verify'
);

console.log('✅ Rate limiting configured');

// Initialize detector
let detector: MisinformationDetector;
let isInitialized = false;

async function initializeDetector() {
  try {
    console.log('📦 Initializing detector...');
    detector = new MisinformationDetector();
    
    console.log('🔗 Connecting to vector store...');
    await detector.initializeVectorStore();

    isInitialized = true;
    console.log('✅ Misinformation detector initialized');
    console.log('✅ Agent orchestrator ready (will be created per request)');
  } catch (error: any) {
    console.error('❌ Failed to initialize detector:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Middleware to check if detector is initialized
function checkInitialized(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): express.Response | void {
  if (!isInitialized) {
    // Allow requests to continue in degraded mode, but add a header so
    // clients can detect reduced functionality.
    res.setHeader('X-Service-Degraded', 'true');
    console.warn('⚠️ Incoming request while detector not initialized; proceeding in degraded mode');
  }
  return next();
}

// Routes

// Health check (works even during initialization)
app.get('/health', async (req, res) => {
  const redisHealth = await redisService.getHealth();
  res.json({ 
    status: isInitialized ? 'healthy' : 'initializing', 
    timestamp: new Date().toISOString(),
    service: 'misinformation-detector-api',
    redis: redisHealth
  });
});

// Get API info
app.get('/', async (req, res) => {
  const redisHealth = await redisService.getHealth();
  res.json({
    name: 'Misinformation Detection API',
    version: '1.0.0',
    status: isInitialized ? 'ready' : 'initializing',
    redis: redisHealth.status,
    endpoints: {
      'POST /verify-claim': 'Verify a claim against news sources (Redis cached)',
      'POST /verify-claim-agentic': 'Verify using agentic approach (Redis cached)',
      'GET /verify-stream': 'Stream verification results (SSE)',
      'POST /update-news': 'Update news database with topics',
      'POST /cache/clear': 'Clear Redis / memory verification and rumor caches',
      'GET /news': 'Fetch latest curated news items',
      'GET /health': 'Health check with Redis status',
      'GET /stats': 'Get system and Redis statistics',
      'GET /tokens': 'Get Groq + Hugging Face token usage'
    }
  });
});

// Verify claim endpoint
app.post('/verify-claim', checkInitialized, verifyLimiter, async (req, res) => {
  try {
    const { claim } = req.body;

    if (!claim || typeof claim !== 'string' || claim.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid claim',
        message: 'Claim must be a non-empty string'
      });
    }

    if (claim.length > 1000) {
      return res.status(400).json({
        error: 'Claim too long',
        message: 'Claim must be less than 1000 characters'
      });
    }

    const trimmedClaim = claim.trim();
    const startTime = Date.now();

    // Check Redis / in-memory cache first
    const cachedResult = await redisService.getCachedVerification<VerificationResult>(trimmedClaim, 'standard');
    if (cachedResult) {
      console.log(`⚡ Cache HIT for claim: "${trimmedClaim.substring(0, 80)}..."`);
      return res.json({
        success: true,
        data: {
          claim: trimmedClaim,
          verification: cachedResult,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            evidenceCount: cachedResult.evidence?.length || 0,
            cached: true,
          }
        }
      });
    }

    console.log(`🔍 API: Verifying claim (Cache MISS): "${trimmedClaim.substring(0, 100)}..."`);

    const result: VerificationResult = await detector.verifyClaim(trimmedClaim);
    const processingTime = Date.now() - startTime;

    // Cache the result in Redis
    await redisService.setCachedVerification(trimmedClaim, result, 'standard');

    return res.json({
      success: true,
      data: {
        claim: trimmedClaim,
        verification: result,
        metadata: {
          processingTimeMs: processingTime,
          timestamp: new Date().toISOString(),
          evidenceCount: result.evidence.length,
          cached: false,
        }
      }
    });

  } catch (error: any) {
    console.error('❌ Error in verify-claim:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
      message: 'An error occurred while verifying the claim'
    });
  }
});

// SSE STREAMING ENDPOINT
app.get("/verify-stream", checkInitialized, async (req, res) => {
  const claim = req.query.claim as string;
  if (!claim) return res.status(400).json({ error: "claim required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  req.on("close", () => {
    res.end();
  });

  // Create per-request context (each request gets its own isolated context)
  const context: import('./agent-orchestrator').VerificationContext = {
    userId: (req as any).user?.id || req.headers['x-user-id'] as string || undefined,
    userName: (req as any).user?.email || req.headers['x-user-email'] as string || undefined,
    conversationId: req.query.conversationId as string || undefined,
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  const orchestrator = new AgentOrchestrator(detector, (msg) => send("step", msg), context);

  try {
    const result = await orchestrator.verifyClaimAgentic(claim, context);
    send("final", result);
  } catch (e: any) {
    send("error", { message: e?.message || "verification failed" });
  } finally {
    res.end();
  }

  return res;
});

// Agentic RAG verification endpoint
app.post('/verify-claim-agentic', checkInitialized, verifyLimiter, async (req, res) => {
  try {
    const { claim } = req.body;

    if (!claim || typeof claim !== 'string' || claim.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid claim',
        message: 'Claim must be a non-empty string'
      });
    }

    if (claim.length > 1000) {
      return res.status(400).json({
        error: 'Claim too long',
        message: 'Claim must be less than 1000 characters'
      });
    }

    const trimmedClaim = claim.trim();
    const startTime = Date.now();

    // Check Redis / in-memory cache first
    const cachedResult = await redisService.getCachedVerification<any>(trimmedClaim, 'agentic');
    if (cachedResult) {
      console.log(`⚡ Agentic Cache HIT for claim: "${trimmedClaim.substring(0, 80)}..."`);
      return res.json({
        success: true,
        data: {
          claim: trimmedClaim,
          verification: cachedResult,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            evidenceCount: cachedResult.evidence?.length || 0,
            verificationType: 'agentic-rag',
            cached: true,
          }
        }
      });
    }

    console.log(`🤖 API: Agentic verification (Cache MISS) for claim: "${trimmedClaim.substring(0, 100)}..."`);

    // Create per-request context (each request gets its own isolated context)
    const context: import('./agent-orchestrator').VerificationContext = {
      userId: (req as any).user?.id || req.headers['x-user-id'] as string || undefined,
      userName: (req as any).user?.email || req.headers['x-user-email'] as string || undefined,
      conversationId: req.body.conversationId || undefined,
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const orchestrator = new AgentOrchestrator(detector, undefined, context);
    const result = await orchestrator.verifyClaimAgentic(trimmedClaim, context);
    const processingTime = Date.now() - startTime;

    // Cache the agentic verification result
    await redisService.setCachedVerification(trimmedClaim, result, 'agentic');

    return res.json({
      success: true,
      data: {
        claim: trimmedClaim,
        verification: result,
        metadata: {
          processingTimeMs: processingTime,
          timestamp: new Date().toISOString(),
          evidenceCount: result.evidence?.length || 0,
          verificationType: 'agentic-rag',
          cached: false,
        }
      }
    });

  } catch (error: any) {
    console.error('❌ Error in agentic verification:', error);
    return res.status(500).json({
      success: false,
      error: 'Agentic verification failed',
      message: 'An error occurred while verifying the claim using agentic approach'
    });
  }
});

// Update news database endpoint
app.post('/update-news', checkInitialized, async (req, res) => {
  try {
    const { topics } = req.body;
    
    if (!topics || !Array.isArray(topics)) {
      return res.status(400).json({
        error: 'Invalid topics',
        message: 'Topics must be an array of strings'
      });
    }

    if (topics.length > 10) {
      return res.status(400).json({
        error: 'Too many topics',
        message: 'Maximum 10 topics allowed per request'
      });
    }

    const validTopics = topics.filter(t => typeof t === 'string' && t.trim().length > 0);
    
    if (validTopics.length === 0) {
      return res.status(400).json({
        error: 'No valid topics',
        message: 'At least one valid topic required'
      });
    }

    console.log(`📰 API: Updating news for topics: ${validTopics.join(', ')}`);
    
    await detector.updateNewsDatabase(validTopics);
    
    return res.json({
      success: true,
      message: `News database updated for ${validTopics.length} topics`,
      topics: validTopics
    });

  } catch (error: any) {
    console.error('❌ Error in update-news:', error);
    return res.status(500).json({
      success: false,
      error: 'Update failed',
      message: 'An error occurred while updating the news database'
    });
  }
});

// Public news fetch endpoint (client-facing)
app.get('/news', async (req, res) => {
  try {
    // if detector isn't initialized yet, still allow the route but warn
    if (!isInitialized) {
      // Try to initialize lazily (best-effort)
      try {
        await initializeDetector();
      } catch (err) {
        // proceed — we'll still try to fulfill request with error message
      }
    }

    const q = (req.query.q as string) || 'latest news';
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    if (!isInitialized || !detector) {
      return res.status(503).json({ success: false, error: 'Service not ready' });
    }

    const articles = await detector.fetchGoogleNewsSearch(q);

    // Return up to `limit` items and a small normalized structure
    const normalized = (articles || []).slice(0, limit).map((a: any) => ({
      title: a.title || a.snippet || '',
      snippet: a.snippet || a.title || '',
      link: a.link || a.url || '',
      date: a.date || a.published_at || new Date().toISOString(),
      source: a.source || a.source_name || '',
    }));

    return res.json({ success: true, data: normalized });
  } catch (error: any) {
    console.error('❌ Error in /news:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Failed to fetch news' });
  }
});

// Token usage endpoint
app.get('/tokens', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const lifetime = getLifetimeUsage();
    const events = getRecentTokenEvents(limit);

    res.json({
      success: true,
      data: {
        lifetime,
        recentEvents: events,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Error getting token usage:', error);
    res.status(500).json({ success: false, error: 'Failed to get token usage' });
  }
});

// Clear verification and rumor cache
app.post('/cache/clear', async (req, res) => {
  try {
    const clearedCount = await redisService.clearCache();
    return res.json({
      success: true,
      message: `TruthSpotter cache cleared successfully (${clearedCount} entries removed)`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Error clearing cache:', error);
    return res.status(500).json({
      success: false,
      error: 'Cache clear failed',
      message: error?.message || 'Failed to clear cache'
    });
  }
});

// System stats endpoint
app.get('/stats', checkInitialized, async (req, res) => {
  try {
    const redisHealth = await redisService.getHealth();
    const stats = {
      status: 'operational',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      redis: redisHealth,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('❌ Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', error);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`
  });
});

// Start server
async function startServer() {
  try {
    console.log('🔧 Initializing services...');
    try {
      await initializeDetector();
    } catch (err) {
      console.error('⚠️ Detector initialization failed — starting server in degraded mode.');
    }

    app.listen(PORT, () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🚀 Misinformation Detection API running on port ${PORT}`);
      console.log(`📖 API Documentation: http://localhost:${PORT}/`);
      console.log(`💚 Health Check: http://localhost:${PORT}/health`);
      if (!isInitialized) console.log('⚠️ Running in degraded mode: detector not initialized');
      console.log(`${'='.repeat(60)}\n`);
    });

    // Optional: Start continuous news monitoring (disabled by default to save resources)
    // Uncomment if you want automatic updates
    /*
    const monitoringTopics = [
      'breaking news india',
      'government policy',
      'social media rumors',
      'fact check news'
    ];
    
    setInterval(async () => {
      try {
        await detector.updateNewsDatabase(monitoringTopics);
        console.log('✅ Scheduled news update completed');
      } catch (error) {
        console.error('❌ Scheduled news update failed:', error);
      }
    }, 60 * 60 * 1000);
    */

  } catch (error: any) {
    console.error('❌ Failed to start server:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

if (require.main === module) {
  startServer();
}

export { app, detector };